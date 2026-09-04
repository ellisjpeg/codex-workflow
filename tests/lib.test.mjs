import assert from "node:assert/strict";
import * as asar from "@electron/asar";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  adhocEntitlementsPath,
  atomicReplace,
  backupAppleSignature,
  compatibilityManifest,
  headerHash,
  preflight,
  recoverTransaction,
  resignPatchedAppArgs,
  restoreAppleSignature,
  restoreFilePair,
  restoreRuntimeFiles,
  runtimeRoot,
  supportedBuild,
  supportedVersion,
  transactionRecoveryStatus,
  validateSourceFingerprint,
  validateTransactionJournal,
  writeJsonAtomic,
} from "../scripts/lib.mjs";

const libSource = readFileSync(new URL("../scripts/lib.mjs", import.meta.url), "utf8");

test("compatibility guard names the audited Codex version and build", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(supportedVersion, "26.901.20858");
  assert.equal(supportedBuild, "7658");
  assert.equal(compatibilityManifest.workflowVersion, "0.5.12");
  assert.equal(compatibilityManifest.workflowVersion, pkg.version);
  assert.equal(compatibilityManifest.bundleIdentifier, "com.openai.codex");
  assert.equal(compatibilityManifest.packageName, "openai-codex-electron");
});

async function createAsarPair(root, name, marker, {
  build = Number(supportedBuild),
  version = supportedVersion,
  plistBuild = String(build),
  plistVersion = version,
} = {}) {
  const source = join(root, `${name}-source`);
  const targetAsar = join(root, `${name}.asar`);
  const targetPlist = join(root, `${name}.Info.plist`);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "main.cjs"), `module.exports = ${JSON.stringify(marker)};\n`);
  writeFileSync(join(source, "package.json"), `${JSON.stringify({
    name: "openai-codex-electron",
    version,
    codexBuildNumber: build,
    main: "./main.cjs",
  }, null, 2)}\n`);
  await asar.createPackage(source, targetAsar);
  writeFileSync(targetPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.openai.codex</string>
<key>CFBundleShortVersionString</key><string>${plistVersion}</string>
<key>CFBundleVersion</key><string>${plistBuild}</string>
<key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict>
<key>algorithm</key><string>SHA256</string><key>hash</key><string>${headerHash(targetAsar)}</string>
</dict></dict>
</dict></plist>\n`);
  return { targetAsar, targetPlist };
}

test("preflight rejects an unaudited build under the supported version", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-test-"));
  try {
    const fixture = await createAsarPair(root, "wrong-build", "fixture", { build: 7659, plistBuild: "7659" });
    assert.throws(
      () => preflight(fixture.targetAsar, fixture.targetPlist),
      /Unsupported Codex build 7659; expected 7658/u,
    );
    assert.equal(
      preflight(fixture.targetAsar, fixture.targetPlist, { allowVersion: true }).pkg.codexBuildNumber,
      7659,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight rejects package and bundle version or build mismatches", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-test-"));
  try {
    const wrongVersion = await createAsarPair(root, "wrong-version-pair", "fixture", {
      plistVersion: "26.901.20859",
    });
    assert.throws(
      () => preflight(wrongVersion.targetAsar, wrongVersion.targetPlist, { allowVersion: true }),
      /package version .* does not match bundle version/u,
    );
    const wrongBuild = await createAsarPair(root, "wrong-build-pair", "fixture", {
      plistBuild: "7659",
    });
    assert.throws(
      () => preflight(wrongBuild.targetAsar, wrongBuild.targetPlist, { allowVersion: true }),
      /package build .* does not match bundle build/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixtureJournal(overrides = {}) {
  const id = "20260831-020000-12345678-1234-4abc-8def-1234567890ab";
  const transactionDir = join(runtimeRoot, "transactions", id);
  return {
    schemaVersion: 1,
    id,
    phase: "prepared",
    transactionDir,
    rollbackAsar: join(transactionDir, "rollback.asar"),
    rollbackPlist: join(transactionDir, "rollback.Info.plist"),
    runtimeFiles: [
      { relativePath: "runtime/main.cjs", existed: true },
      { relativePath: "runtime/preload.cjs", existed: false },
      { relativePath: "runtime/updater.cjs", existed: false },
      { relativePath: "runtime/version.json", existed: false },
      { relativePath: "update-config.json", existed: false },
    ],
    ...overrides,
  };
}

test("ad-hoc re-sign uses a local signature and Electron-safe entitlements", () => {
  const entitlements = readFileSync(adhocEntitlementsPath, "utf8");
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/u);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/u);
  assert.deepEqual(resignPatchedAppArgs("/Applications/ChatGPT.app"), [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--options",
    "runtime",
    "--entitlements",
    adhocEntitlementsPath,
    "/Applications/ChatGPT.app",
  ]);
  const installSource = readFileSync(new URL("../scripts/install.mjs", import.meta.url), "utf8");
  assert.match(installSource, /resignPatchedApp\(\)/u);
  const uninstallSource = readFileSync(new URL("../scripts/uninstall.mjs", import.meta.url), "utf8");
  assert.match(uninstallSource, /restoreAppleSignature\(/u);
});

test("Apple signature backup is copied once and restored without consuming the backup", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-sign-"));
  try {
    const app = join(root, "ChatGPT.app");
    const backupDir = join(root, "backup");
    mkdirSync(join(app, "Contents", "_CodeSignature"), { recursive: true });
    writeFileSync(join(app, "Contents", "_CodeSignature", "CodeResources"), "original-sig");
    writeFileSync(join(app, "Contents", "CodeResources"), "original-contents-resources");
    writeFileSync(join(app, "Contents", "embedded.provisionprofile"), "openai-profile");
    backupAppleSignature(backupDir, app);
    writeFileSync(join(app, "Contents", "_CodeSignature", "CodeResources"), "adhoc-sig");
    writeFileSync(join(app, "Contents", "CodeResources"), "adhoc-contents-resources");
    writeFileSync(join(app, "Contents", "embedded.provisionprofile.openai"), "stashed");
    rmSync(join(app, "Contents", "embedded.provisionprofile"), { force: true });
    backupAppleSignature(backupDir, app);
    assert.equal(
      readFileSync(join(backupDir, "AppleSignature", "_CodeSignature", "CodeResources"), "utf8"),
      "original-sig",
    );
    assert.equal(restoreAppleSignature(backupDir, app), true);
    assert.equal(readFileSync(join(app, "Contents", "_CodeSignature", "CodeResources"), "utf8"), "original-sig");
    assert.equal(readFileSync(join(app, "Contents", "CodeResources"), "utf8"), "original-contents-resources");
    assert.equal(readFileSync(join(app, "Contents", "embedded.provisionprofile"), "utf8"), "openai-profile");
    assert.equal(existsSync(join(app, "Contents", "embedded.provisionprofile.openai")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomicReplace swaps a file without consuming its source", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-test-"));
  try {
    const source = join(root, "source");
    const target = join(root, "target");
    writeFileSync(source, "new");
    writeFileSync(target, "old");
    atomicReplace(source, target);
    assert.equal(readFileSync(source, "utf8"), "new");
    assert.equal(readFileSync(target, "utf8"), "new");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeJsonAtomic leaves a complete JSON document", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-test-"));
  try {
    const target = join(root, "state.json");
    writeJsonAtomic(target, { schemaVersion: 1, enabled: true });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), {
      schemaVersion: 1,
      enabled: true,
    });
    assert.equal(statSync(target).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime data uses the current macOS user profile", () => {
  assert.equal(
    runtimeRoot,
    join(homedir(), "Library", "Application Support", "Codex Workflow"),
  );
});

test("background updater checks published releases every five minutes", () => {
  assert.doesNotMatch(libSource, /<key>WatchPaths<\/key>/u);
  assert.match(libSource, /<key>StartInterval<\/key><integer>300<\/integer>/u);
  assert.doesNotMatch(libSource, /<integer>21600<\/integer>/u);
});

test("restoreFilePair replaces both fixture targets", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-test-"));
  try {
    const backupAsar = join(root, "backup.asar");
    const backupPlist = join(root, "backup.plist");
    const targetAsar = join(root, "target.asar");
    const targetPlist = join(root, "target.plist");
    writeFileSync(backupAsar, "stock-asar");
    writeFileSync(backupPlist, "stock-plist");
    writeFileSync(targetAsar, "patched-asar");
    writeFileSync(targetPlist, "patched-plist");
    restoreFilePair(backupAsar, backupPlist, targetAsar, targetPlist);
    assert.equal(readFileSync(targetAsar, "utf8"), "stock-asar");
    assert.equal(readFileSync(targetPlist, "utf8"), "stock-plist");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restoreRuntimeFiles restores old files and removes newly-created files", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-test-"));
  try {
    const transactionDir = join(root, "transaction");
    const targetRoot = join(root, "target");
    mkdirSync(join(transactionDir, "rollback-runtime", "runtime"), { recursive: true });
    mkdirSync(join(targetRoot, "runtime"), { recursive: true });
    writeFileSync(join(transactionDir, "rollback-runtime", "runtime", "main.cjs"), "old-main");
    writeFileSync(join(targetRoot, "runtime", "main.cjs"), "new-main");
    writeFileSync(join(targetRoot, "runtime", "preload.cjs"), "new-preload");
    restoreRuntimeFiles({
      transactionDir,
      runtimeFiles: [
        { relativePath: "runtime/main.cjs", existed: true },
        { relativePath: "runtime/preload.cjs", existed: false },
      ],
    }, targetRoot);
    assert.equal(readFileSync(join(targetRoot, "runtime", "main.cjs"), "utf8"), "old-main");
    assert.equal(existsSync(join(targetRoot, "runtime", "preload.cjs")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("transaction journals reject paths outside the managed transaction", () => {
  assert.throws(
    () => validateTransactionJournal(fixtureJournal({ rollbackAsar: "/tmp/unsafe.asar" })),
    /unsafe paths/u,
  );
});

test("transaction journals require complete signature rollback metadata", () => {
  const journal = fixtureJournal();
  assert.throws(
    () => validateTransactionJournal({
      ...journal,
      rollbackAppleSignature: join(journal.transactionDir, "rollback-AppleSignature"),
    }),
    /invalid signature rollback metadata/u,
  );
});

test("transaction journals require the complete managed runtime set", () => {
  assert.throws(
    () => validateTransactionJournal(fixtureJournal({
      runtimeFiles: [{ relativePath: "runtime/main.cjs", existed: true }],
    })),
    /incomplete runtime rollback metadata/u,
  );
});

test("transaction journals accept the supported recovery schema", () => {
  const journal = fixtureJournal();
  assert.equal(validateTransactionJournal(journal), journal);
});

test("source fingerprints reject path-like version fields", () => {
  assert.throws(
    () => validateSourceFingerprint({
      version: "../../escape",
      build: "7119",
      asarSha256: "a".repeat(64),
      headerSha256: "b".repeat(64),
    }),
    /invalid version/u,
  );
});

test("legacy journals without runtime rollback metadata are not auto-recovered", () => {
  const journal = fixtureJournal();
  delete journal.runtimeFiles;
  assert.deepEqual(transactionRecoveryStatus(validateTransactionJournal(journal)), {
    ready: false,
    reason: "legacy-journal-missing-runtime-metadata",
  });
});

test("interrupted transaction phases restore a verified ASAR pair and runtime snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-test-"));
  try {
    const stock = await createAsarPair(root, "stock", "stock");
    const patched = await createAsarPair(root, "patched", "patched");
    const targetAsar = join(root, "target.asar");
    const targetPlist = join(root, "target.Info.plist");
    const targetRuntimeRoot = join(root, "runtime-target");
    const transactionDir = join(root, "transaction");
    mkdirSync(join(transactionDir, "rollback-runtime", "runtime"), { recursive: true });
    writeFileSync(join(transactionDir, "rollback-runtime", "runtime", "main.cjs"), "old-main");

    for (const phase of [
      "prepared",
      "runtime-installed",
      "asar-replaced",
      "plist-replaced",
      "signed",
      "asar-restored",
      "plist-restored",
    ]) {
      cpSync(patched.targetAsar, targetAsar);
      cpSync(patched.targetPlist, targetPlist);
      mkdirSync(join(targetRuntimeRoot, "runtime"), { recursive: true });
      writeFileSync(join(targetRuntimeRoot, "runtime", "main.cjs"), "new-main");
      writeFileSync(join(targetRuntimeRoot, "runtime", "preload.cjs"), "new-preload");
      let completed = false;
      const journal = {
        id: `fixture-${phase}`,
        phase,
        transactionDir,
        rollbackAsar: stock.targetAsar,
        rollbackPlist: stock.targetPlist,
        runtimeFiles: [
          { relativePath: "runtime/main.cjs", existed: true },
          { relativePath: "runtime/preload.cjs", existed: false },
        ],
      };

      assert.deepEqual(recoverTransaction(journal, {
        targetAsar,
        targetPlist,
        targetRuntimeRoot,
        finish: () => { completed = true; },
      }), { recovered: true, id: journal.id, phase });
      assert.equal(preflight(targetAsar, targetPlist, { allowVersion: true }).fingerprint.asarSha256,
        preflight(stock.targetAsar, stock.targetPlist, { allowVersion: true }).fingerprint.asarSha256);
      assert.equal(readFileSync(join(targetRuntimeRoot, "runtime", "main.cjs"), "utf8"), "old-main");
      assert.equal(existsSync(join(targetRuntimeRoot, "runtime", "preload.cjs")), false);
      assert.equal(completed, true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("transaction recovery restores the complete signature-side snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-sign-recovery-"));
  try {
    const stock = await createAsarPair(root, "stock", "stock");
    const patched = await createAsarPair(root, "patched", "patched");
    const targetAsar = join(root, "target.asar");
    const targetPlist = join(root, "target.Info.plist");
    const targetApp = join(root, "ChatGPT.app");
    const transactionDir = join(root, "transaction");
    const signatureSnapshot = join(transactionDir, "rollback-AppleSignature");
    mkdirSync(join(signatureSnapshot, "_CodeSignature"), { recursive: true });
    mkdirSync(join(targetApp, "Contents", "_CodeSignature"), { recursive: true });
    cpSync(patched.targetAsar, targetAsar);
    cpSync(patched.targetPlist, targetPlist);
    writeFileSync(join(signatureSnapshot, "_CodeSignature", "CodeResources"), "original-sig");
    writeFileSync(join(signatureSnapshot, "Contents-CodeResources"), "original-contents-resources");
    writeFileSync(join(signatureSnapshot, "embedded.provisionprofile"), "openai-profile");
    writeFileSync(join(targetApp, "Contents", "_CodeSignature", "CodeResources"), "adhoc-sig");
    writeFileSync(join(targetApp, "Contents", "CodeResources"), "adhoc-contents-resources");
    writeFileSync(join(targetApp, "Contents", "embedded.provisionprofile.openai"), "stashed-profile");

    recoverTransaction({
      id: "fixture-signature-recovery",
      phase: "signed",
      transactionDir,
      rollbackAsar: stock.targetAsar,
      rollbackPlist: stock.targetPlist,
      rollbackAppleSignature: signatureSnapshot,
      hadBundleSignature: true,
      runtimeFiles: [],
    }, {
      targetAsar,
      targetPlist,
      targetRuntimeRoot: root,
      targetApp,
      finish: () => {},
    });

    assert.equal(readFileSync(join(targetApp, "Contents", "_CodeSignature", "CodeResources"), "utf8"), "original-sig");
    assert.equal(readFileSync(join(targetApp, "Contents", "CodeResources"), "utf8"), "original-contents-resources");
    assert.equal(readFileSync(join(targetApp, "Contents", "embedded.provisionprofile"), "utf8"), "openai-profile");
    assert.equal(existsSync(join(targetApp, "Contents", "embedded.provisionprofile.openai")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed post-recovery verification leaves the transaction incomplete", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-test-"));
  try {
    const stock = await createAsarPair(root, "stock", "stock");
    const patched = await createAsarPair(root, "patched", "patched");
    const targetAsar = join(root, "target.asar");
    const targetPlist = join(root, "target.Info.plist");
    cpSync(patched.targetAsar, targetAsar);
    cpSync(patched.targetPlist, targetPlist);
    let completed = false;
    assert.throws(() => recoverTransaction({
      id: "fixture-failed-verification",
      phase: "asar-replaced",
      transactionDir: root,
      rollbackAsar: stock.targetAsar,
      rollbackPlist: stock.targetPlist,
      runtimeFiles: [],
    }, {
      targetAsar,
      targetPlist,
      targetRuntimeRoot: root,
      verifyRestored: () => { throw new Error("fixture verification failed"); },
      finish: () => { completed = true; },
    }), /fixture verification failed/u);
    assert.equal(completed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
