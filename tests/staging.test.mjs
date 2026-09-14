import assert from "node:assert/strict";
import * as asar from "@electron/asar";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildPatchedAsar,
  expectedBundleIdentifier,
  expectedPackageName,
  fileHash,
  headerHash,
  preflight,
  supportedBuild,
  supportedVersion,
} from "../scripts/lib.mjs";
import {
  cleanupStaging,
  listenerOwnershipForProcess,
  launchStaging,
  parseLsofRecords,
  prepareStaging,
  processIdentityMatches,
  processStartToken,
  restoreStaging,
  refreshStaging,
  stopStaging,
  assertStagingRoot,
  assertManagedStagingPath,
  stagingBaseRoot,
  stagingBundleIdentifier,
  stagingExecutableName,
  stagingEnvironment,
  stagingLayout,
  stagingName,
  stagingPrefix,
  stagingUnixSocketPathMaxBytes,
  stagingUpdaterPath,
} from "../scripts/staging.mjs";

const fixturePort = 49258;

test("runtime refresh rejects a running stage and preserves stopped-stage settings", async () => {
  const fixture = await createStockFixture();
  let manifest;
  try {
    manifest = await prepareFixture(fixture);
    const target = join(manifest.workflowRoot,"runtime","preload.cjs");
    const before = fileHash(target), settings = fileHash(manifest.settings);
    assert.throws(() => refreshStaging(manifest.manifest,{listAppProcesses:()=>[{}]}),/Stop the exact staging process/);
    assert.equal(fileHash(target),before);
    writeFileSync(manifest.manifest,JSON.stringify({...manifest,status:"stopped"}));
    writeFileSync(target,"old disposable runtime");
    refreshStaging(manifest.manifest,{listAppProcesses:()=>[],signatureIsValid:()=>true});
    assert.equal(fileHash(target),before);
    assert.equal(fileHash(manifest.settings),settings);
  } finally {
    if (manifest) {
      restoreStaging(manifest.manifest,{listAppProcesses:()=>[],resignPatchedApp(){},signatureIsValid:()=>true});
      cleanupStaging(manifest.manifest,{listAppProcesses:()=>[]});
    }
    rmSync(fixture.root,{recursive:true,force:true});
  }
});

function infoPlist(integrity) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${expectedBundleIdentifier}</string>
  <key>CFBundleName</key><string>ChatGPT</string>
  <key>CFBundleDisplayName</key><string>ChatGPT</string>
  <key>CFBundleExecutable</key><string>ChatGPT</string>
  <key>CFBundleShortVersionString</key><string>${supportedVersion}</string>
  <key>CFBundleVersion</key><string>${supportedBuild}</string>
  <key>CFBundleURLTypes</key><array/>
  <key>CFBundleDocumentTypes</key><array/>
  <key>ElectronAsarIntegrity</key>
  <dict>
    <key>Resources/app.asar</key>
    <dict>
      <key>algorithm</key><string>SHA256</string>
      <key>hash</key><string>${integrity}</string>
    </dict>
  </dict>
</dict>
</plist>
`;
}

async function createStockFixture() {
  const root = mkdtempSync("/private/tmp/codex-workflow-stock-fixture-");
  const app = join(root, "ChatGPT.app");
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  const macos = join(contents, "MacOS");
  const source = join(root, "asar-source");
  mkdirSync(resources, { recursive: true });
  mkdirSync(macos, { recursive: true });
  mkdirSync(source);
  writeFileSync(join(source, "package.json"), `${JSON.stringify({
    name: expectedPackageName,
    version: supportedVersion,
    codexBuildNumber: Number(supportedBuild),
    main: "./main.js",
  }, null, 2)}\n`);
  writeFileSync(join(source, "main.js"), "module.exports = {};\n");
  const targetAsar = join(resources, "app.asar");
  await asar.createPackage(source, targetAsar);
  const plist = join(contents, "Info.plist");
  writeFileSync(plist, infoPlist(headerHash(targetAsar)));
  const executable = join(macos, "ChatGPT");
  writeFileSync(executable, "#!/bin/sh\nexit 0\n");
  chmodSync(executable, 0o755);
  return { root, app, asar: targetAsar, plist };
}

async function patchFixtureFromVerifiedBackup(fixture) {
  const backupDir = join(fixture.root, "verified-backup");
  const backupAsar = join(backupDir, "app.asar");
  const backupPlist = join(backupDir, "Info.plist");
  const manifestPath = join(backupDir, "manifest.json");
  mkdirSync(backupDir);
  cpSync(fixture.asar, backupAsar);
  cpSync(fixture.plist, backupPlist);
  const stock = preflight(backupAsar, backupPlist);
  const source = { ...stock.fingerprint, originalMain: stock.originalMain };
  const manifest = { schemaVersion: 1, source: stock.fingerprint };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const patchedAsar = join(fixture.root, "patched.asar");
  await buildPatchedAsar(backupAsar, patchedAsar, stock.fingerprint, join(fixture.root, "runtime"));
  cpSync(patchedAsar, fixture.asar);
  writeFileSync(fixture.plist, infoPlist(headerHash(fixture.asar)));
  return {
    backupDir,
    backupAsar,
    backupPlist,
    manifestPath,
    manifest,
    fingerprint: stock.fingerprint,
    source,
  };
}

function fixtureHooks(fixture, state, overrides = {}) {
  return {
    assertPortAvailable() {},
    sourcePreflight: () => ({
      ...preflight(fixture.asar, fixture.plist),
      sourceAsar: fixture.asar,
      sourcePlist: fixture.plist,
    }),
    clonePreflight: (targetAsar, targetPlist) => preflight(targetAsar, targetPlist),
    cloneApp(_source, target) {
      state.cloneCount = (state.cloneCount || 0) + 1;
      cpSync(fixture.app, target, { recursive: true });
    },
    createRoot() {
      state.stagingRoot = mkdtempSync(join(stagingBaseRoot, `${stagingPrefix}test-`));
      return state.stagingRoot;
    },
    resignPatchedApp() {},
    signatureIsValid: () => true,
    ...overrides,
  };
}

async function prepareFixture(fixture, state = {}, overrides = {}) {
  return prepareStaging(fixturePort, fixtureHooks(fixture, state, overrides));
}

function readJson(target) {
  return JSON.parse(readFileSync(target, "utf8"));
}

function launchedIdentity(manifest, processId = 43121) {
  return {
    processId,
    processGroupId: processId,
    startedAt: "Thu Sep  3 12:00:00 2026",
    executable: manifest.executable,
  };
}

test("staging layout isolates every mutable root under one generated temporary directory", () => {
  const root = join(stagingBaseRoot, `${stagingPrefix}fixture`);
  const layout = stagingLayout(root, 49258);
  assert.equal(layout.app, join(root, `${stagingName}.app`));
  assert.equal(layout.executable, join(layout.app, "Contents", "MacOS", stagingExecutableName));
  assert.equal(layout.devToolsPort, 49258);
  assert.equal(new Set([
    layout.home,
    layout.temporary,
    layout.userData,
    layout.codexHome,
    layout.workflowRoot,
    layout.settings,
    layout.logs,
    layout.journal,
    layout.updates,
    layout.updateState,
    layout.backups,
  ]).size, 11);
  for (const target of Object.values(layout).filter((value) => typeof value === "string")) {
    assert.ok(target === root || target.startsWith(`${root}/`));
  }
  assert.equal(stagingBundleIdentifier, "com.openai.codex.workflow-staging.v2690131953");
  assert.ok(
    Buffer.byteLength(join(layout.codexHome, "ipc", "ipc.sock")) <= stagingUnixSocketPathMaxBytes,
  );
});

test("staging launch environment is allowlisted and isolates shell startup files", () => {
  const root = mkdtempSync(join(stagingBaseRoot, stagingPrefix));
  const layout = stagingLayout(root, fixturePort);
  const hostHome = join(root, "host-home");
  try {
    mkdirSync(hostHome);
    mkdirSync(layout.home, { recursive: true });
    mkdirSync(layout.temporary, { recursive: true });
    writeFileSync(join(hostHome, ".zshenv"), "export REVIEW_SECRET_TOKEN=restored-by-shell\n");
    const environment = stagingEnvironment(layout, {
      HOME: hostHome,
      ZDOTDIR: hostHome,
      USER: "fixture-user",
      LOGNAME: "fixture-user",
      LANG: "en_GB.UTF-8",
      SSH_AUTH_SOCK: "/private/tmp/agent.sock",
      API_TOKEN: "host-token",
      AWS_SECRET_ACCESS_KEY: "host-key",
      CODEX_SESSION_ID: "host-session",
    });
    assert.equal(environment.HOME, userInfo().homedir);
    assert.notEqual(environment.HOME, hostHome);
    assert.equal(environment.CODEX_HOME, layout.codexHome);
    assert.equal(environment.CODEX_ELECTRON_USER_DATA_PATH, layout.userData);
    assert.equal(environment.ZDOTDIR, layout.home);
    assert.equal(environment.TMPDIR, layout.temporary);
    assert.equal(environment.XDG_CONFIG_HOME, join(layout.home, ".config"));
    assert.equal(environment.USER, "fixture-user");
    assert.equal(environment.LANG, "en_GB.UTF-8");
    for (const name of ["SSH_AUTH_SOCK", "API_TOKEN", "AWS_SECRET_ACCESS_KEY", "CODEX_SESSION_ID"]) {
      assert.equal(Object.hasOwn(environment, name), false);
    }
    const shell = spawnSync("/bin/zsh", ["-lic", "env"], { env: environment, encoding: "utf8" });
    assert.equal(shell.status, 0, shell.stderr);
    assert.doesNotMatch(shell.stdout, /host-token|host-key|host-session|restored-by-shell/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process birth identity ignores locale-only lstart formatting", () => {
  const british = "Thu  3 Sep 20:09:05 2026";
  const cLocale = "Thu Sep  3 20:09:05 2026";
  assert.equal(processStartToken(british), "2026-09-03T20:09:05");
  assert.equal(processStartToken(cLocale), "2026-09-03T20:09:05");
  assert.equal(processStartToken("2026-09-03T20:09:05"), "2026-09-03T20:09:05");
  assert.equal(processIdentityMatches(
    { processId: 42, processGroupId: 42, startedAt: british, executable: "/tmp/app" },
    { processId: 42, processGroupId: 42, startedAt: cLocale, executable: "/tmp/app" },
  ), true);
});

test("managed staging paths reject traversal and symlink redirection", () => {
  const root = mkdtempSync(join(stagingBaseRoot, stagingPrefix));
  try {
    mkdirSync(join(root, "state"));
    symlinkSync("/Applications", join(root, "state", "redirect"));
    symlinkSync("/path/that/does/not/exist", join(root, "state", "dangling"));
    assert.throws(
      () => assertManagedStagingPath(root, "/Applications/ChatGPT.app"),
      /escapes its generated root/u,
    );
    assert.throws(
      () => assertManagedStagingPath(root, join(root, "state", "redirect", "ChatGPT.app")),
      /must not contain symbolic links/u,
    );
    assert.throws(
      () => assertManagedStagingPath(root, join(root, "state", "dangling", "app.asar")),
      /must not contain symbolic links/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staging root rejects a dangling symbolic link", () => {
  const root = join(stagingBaseRoot, `${stagingPrefix}dangling-${process.pid}`);
  symlinkSync("/path/that/does/not/exist", root);
  try {
    assert.throws(() => assertStagingRoot(root), /must not be a symbolic link/u);
  } finally {
    rmSync(root, { force: true });
  }
});

test("staging root and DevTools guards reject production, nesting, and unsafe ports", () => {
  assert.throws(() => assertStagingRoot("/Applications/ChatGPT.app"), /generated direct child/u);
  assert.throws(
    () => assertStagingRoot(join(stagingBaseRoot, stagingPrefix, "nested")),
    /generated direct child/u,
  );
  const root = join(stagingBaseRoot, `${stagingPrefix}fixture`);
  assert.throws(() => stagingLayout(root, 80), /1024 through 65535/u);
  assert.throws(() => stagingLayout(root, 70000), /1024 through 65535/u);
  assert.throws(
    () => stagingLayout(join(stagingBaseRoot, `${stagingPrefix}${"x".repeat(100)}`), 49258),
    /IPC socket path exceeds/u,
  );
});

test("DevTools ownership rejects wildcard and non-loopback listeners", () => {
  assert.deepEqual(
    parseLsofRecords(`p43120\ncCodex\nf24\ntIPv4\nn127.0.0.1:${fixturePort}\n`),
    [{
      processId: 43120,
      command: "Codex",
      addresses: [`127.0.0.1:${fixturePort}`],
    }],
  );
  const identity = {
    processId: 43120,
    processGroupId: 43120,
    startedAt: "Thu Sep  3 12:00:00 2026",
    executable: "/private/tmp/staging",
  };
  for (const address of [
    `*:${fixturePort}`,
    `0.0.0.0:${fixturePort}`,
    `192.168.1.20:${fixturePort}`,
  ]) {
    assert.throws(
      () => listenerOwnershipForProcess(
        [{ processId: identity.processId, command: "staging", addresses: [address] }],
        identity,
        fixturePort,
        (processId) => ({ ...identity, processId }),
      ),
      /not bound exclusively to loopback/u,
    );
  }
});

test("prepare clones once, builds only the verified clone, and installs a fail-closed updater", async () => {
  const fixture = await createStockFixture();
  const state = { buildInputs: [] };
  const sourceHash = fileHash(fixture.asar);
  const sourcePlistHash = fileHash(fixture.plist);
  let manifest;
  try {
    manifest = await prepareFixture(fixture, state, {
      async buildPatchedAsar(...args) {
        state.buildInputs.push(args[0]);
        await buildPatchedAsar(...args);
        assert.equal(
          JSON.parse(asar.extractFile(args[1], "package.json").toString("utf8")).main,
          "workflow-loader.cjs",
        );
      },
    });
    assert.equal(state.cloneCount, 1);
    assert.deepEqual(state.buildInputs, [manifest.asar]);
    assert.notEqual(fileHash(manifest.asar), sourceHash);
    assert.equal(fileHash(fixture.asar), sourceHash);
    assert.equal(fileHash(fixture.plist), sourcePlistHash);
    const launcherName = spawnSync('/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleExecutable', manifest.plist], {encoding:'utf8'}).stdout.trim();
    const launcher = readFileSync(join(manifest.app,'Contents','MacOS',launcherName),'utf8');
    assert.match(launcher, /exec \/usr\/bin\/env -i/);
    assert.ok(launcher.includes(`'--user-data-dir=${manifest.userData}'`));
    for(const [key,value] of Object.entries(stagingEnvironment(manifest, {}))) assert.ok(launcher.includes(`'${key}=${value}'`));
    const binary = readFileSync(manifest.executable);
    try {
      writeFileSync(manifest.executable, '#!/bin/sh\n/usr/bin/printf "%s\\n" "$CODEX_HOME" "$CODEX_ELECTRON_USER_DATA_PATH" "$@"\n');
      const launched = spawnSync(join(manifest.app,'Contents','MacOS',launcherName), ['--test-argument'], {
        encoding:'utf8', env:{CODEX_HOME:'/wrong/profile',CODEX_ELECTRON_USER_DATA_PATH:'/wrong/user-data'},
      });
      assert.equal(launched.status,0);
      assert.deepEqual(launched.stdout.trim().split('\n'), [manifest.codexHome,manifest.userData,`--user-data-dir=${manifest.userData}`,'--test-argument']);
    } finally { writeFileSync(manifest.executable,binary); }
    assert.equal(fileHash(join(manifest.sourceBackup, "app.asar")), sourceHash);
    assert.deepEqual(manifest.sourceEvidence, {
      kind: "live-stock-app",
      asar: fixture.asar,
      plist: fixture.plist,
      manifest: null,
      fingerprint: manifest.source,
    });
    assert.equal(
      fileHash(join(manifest.workflowRoot, "runtime", "updater.cjs")),
      fileHash(stagingUpdaterPath),
    );
    const updateConfig = readJson(join(manifest.workflowRoot, "update-config.json"));
    assert.equal(updateConfig.updatesDisabled, true);
    assert.equal(updateConfig.sourceRoot, null);
    assert.equal(updateConfig.nodeExecutable, null);
    assert.equal(manifest.updaterIsolation.workflowUpdatesDisabled, true);
    const updater = spawnSync(process.execPath, [
      join(manifest.workflowRoot, "runtime", "updater.cjs"),
      "--apply",
    ], { encoding: "utf8" });
    assert.equal(updater.status, 78);
    assert.match(updater.stderr, /updates are disabled in isolated staging/u);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("prepare restores a patched live clone from its verified backup without production writes", async () => {
  const fixture = await createStockFixture();
  const verified = await patchFixtureFromVerifiedBackup(fixture);
  const state = {};
  const productionHashes = [fixture.asar, fixture.plist, join(fixture.app, "Contents", "MacOS", "ChatGPT")]
    .map(fileHash);
  let resolvedSource;
  let manifest;
  try {
    manifest = await prepareFixture(fixture, state, {
      resolveSourceBackup(source) {
        resolvedSource = source;
        return verified;
      },
    });
    assert.equal(state.cloneCount, 1);
    assert.deepEqual(resolvedSource, verified.fingerprint);
    assert.equal(fileHash(join(manifest.sourceBackup, "app.asar")), verified.source.asarSha256);
    assert.deepEqual(manifest.source, verified.source);
    assert.deepEqual(manifest.sourceEvidence, {
      kind: "verified-workflow-backup",
      asar: verified.backupAsar,
      plist: verified.backupPlist,
      manifest: verified.manifestPath,
      fingerprint: verified.source,
    });
    assert.deepEqual(
      [fixture.asar, fixture.plist, join(fixture.app, "Contents", "MacOS", "ChatGPT")].map(fileHash),
      productionHashes,
    );
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("patched prepare rejects a missing verified source backup before creating a staging root", async () => {
  const fixture = await createStockFixture();
  await patchFixtureFromVerifiedBackup(fixture);
  const state = {};
  const productionHashes = [fixture.asar, fixture.plist].map(fileHash);
  try {
    await assert.rejects(
      prepareFixture(fixture, state, {
        resolveSourceBackup() {
          throw new Error("No verified source backup for fixture");
        },
      }),
      /No verified source backup/u,
    );
    assert.equal(state.cloneCount || 0, 0);
    assert.equal(state.stagingRoot, undefined);
    assert.deepEqual([fixture.asar, fixture.plist].map(fileHash), productionHashes);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("patched prepare rejects a mismatched verified source backup before creating a staging root", async () => {
  const fixture = await createStockFixture();
  const verified = await patchFixtureFromVerifiedBackup(fixture);
  const mismatched = await createStockFixture();
  appendFileSync(mismatched.asar, "mismatch");
  const state = {};
  const productionHashes = [fixture.asar, fixture.plist].map(fileHash);
  try {
    await assert.rejects(
      prepareFixture(fixture, state, {
        resolveSourceBackup: () => ({
          ...verified,
          backupAsar: mismatched.asar,
          backupPlist: mismatched.plist,
        }),
      }),
      /does not match captured source asarSha256/u,
    );
    assert.equal(state.cloneCount || 0, 0);
    assert.equal(state.stagingRoot, undefined);
    assert.deepEqual([fixture.asar, fixture.plist].map(fileHash), productionHashes);
  } finally {
    rmSync(mismatched.root, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("launch rejects a post-prepare ASAR fingerprint change before spawning", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let manifest;
  let spawnCalled = false;
  try {
    manifest = await prepareFixture(fixture, state);
    appendFileSync(manifest.asar, "post-prepare mutation");
    await assert.rejects(
      launchStaging(manifest.manifest, {
        spawnApp() {
          spawnCalled = true;
        },
      }),
      /Prepared staging asarSha256 fingerprint changed before launch/u,
    );
    assert.equal(spawnCalled, false);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      const restored = restoreStaging(manifest.manifest, {
        listAppProcesses: () => [],
        resignPatchedApp() {},
        signatureIsValid: () => true,
      });
      cleanupStaging(restored.manifest, { listAppProcesses: () => [] });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("prepare removes its isolated clone after an interrupted build and preserves the source", async () => {
  const fixture = await createStockFixture();
  const state = {};
  const sourceHash = fileHash(fixture.asar);
  try {
    await assert.rejects(
      prepareFixture(fixture, state, {
        async buildPatchedAsar() {
          throw new Error("fixture build interruption");
        },
      }),
      /fixture build interruption/u,
    );
    assert.equal(state.cloneCount, 1);
    assert.equal(existsSync(state.stagingRoot), false);
    assert.equal(fileHash(fixture.asar), sourceHash);
  } finally {
    if (state.stagingRoot && existsSync(state.stagingRoot)) {
      rmSync(state.stagingRoot, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("prepare rejects a clone whose captured source fingerprint changed", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let buildCalled = false;
  try {
    await assert.rejects(
      prepareFixture(fixture, state, {
        clonePreflight(targetAsar, targetPlist) {
          const cloned = preflight(targetAsar, targetPlist);
          return {
            ...cloned,
            fingerprint: { ...cloned.fingerprint, asarSha256: "0".repeat(64) },
          };
        },
        async buildPatchedAsar() {
          buildCalled = true;
        },
      }),
      /does not match captured source asarSha256/u,
    );
    assert.equal(state.cloneCount, 1);
    assert.equal(buildCalled, false);
    assert.equal(existsSync(state.stagingRoot), false);
  } finally {
    if (state.stagingRoot && existsSync(state.stagingRoot)) {
      rmSync(state.stagingRoot, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("launch proves DevTools ownership and stop signals only the persisted process group", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let manifest;
  try {
    manifest = await prepareFixture(fixture, state);
    const identity = launchedIdentity(manifest);
    const events = [];
    const signals = [];
    let launchEnvironment;
    let running = true;
    const launched = await launchStaging(manifest.manifest, {
      assertPortAvailable(port) {
        events.push(`port:${port}`);
      },
      listAppProcesses: () => [],
      readAnyProcessIdentity: (processId) => ({
        processId,
        processGroupId: identity.processGroupId,
        startedAt: identity.startedAt,
      }),
      readPortListeners: () => [{
        processId: identity.processId,
        command: "staging",
        addresses: [`127.0.0.1:${fixturePort}`],
      }],
      readProcessIdentity: () => running ? identity : null,
      hostEnvironment: {
        USER: "fixture-user",
        SSH_AUTH_SOCK: "/private/tmp/agent.sock",
        REVIEW_API_TOKEN: "host-token",
      },
      signatureIsValid: () => true,
      sleep: async () => {},
      spawnApp(_executable, _args, options) {
        events.push("spawn");
        launchEnvironment = options.env;
        return { pid: identity.processId, unref() {} };
      },
    });
    assert.deepEqual(events, [`port:${fixturePort}`, "spawn"]);
    assert.equal(launchEnvironment.HOME, userInfo().homedir);
    assert.equal(launchEnvironment.ZDOTDIR, manifest.home);
    assert.equal(launchEnvironment.CODEX_HOME, manifest.codexHome);
    assert.equal(launchEnvironment.SSH_AUTH_SOCK, undefined);
    assert.equal(launchEnvironment.REVIEW_API_TOKEN, undefined);
    assert.deepEqual(launched.processIdentity, identity);
    assert.equal(launched.listenerOwnership.port, fixturePort);
    assert.deepEqual(launched.listenerOwnership.listeners.map((entry) => entry.processId), [
      identity.processId,
    ]);

    const stopped = await stopStaging(manifest.manifest, {
      listAppProcesses: () => [],
      readProcessIdentity: () => running ? identity : null,
      signalProcessGroup(processGroupId, signal) {
        signals.push({ processGroupId, signal });
        running = false;
      },
      sleep: async () => {},
      waitForExit: async () => !running,
    });
    assert.deepEqual(signals, [{ processGroupId: identity.processGroupId, signal: "SIGTERM" }]);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.processId, null);
    assert.equal(stopped.processIdentity, null);
    assert.equal(stopped.listenerOwnership, null);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("launch accepts its owned listener after the old ten-second deadline", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let manifest;
  let now = 0;
  let running = true;
  const signals = [];
  try {
    manifest = await prepareFixture(fixture, state);
    const identity = launchedIdentity(manifest, 43125);
    const launched = await launchStaging(manifest.manifest, {
      assertPortAvailable() {},
      listAppProcesses: () => [],
      now: () => now,
      readAnyProcessIdentity: (processId) => ({
        processId,
        processGroupId: identity.processGroupId,
        startedAt: identity.startedAt,
      }),
      readPortListeners: () => now >= 16600 ? [{
        processId: identity.processId,
        command: "staging",
        addresses: [`127.0.0.1:${fixturePort}`],
      }] : [],
      readProcessIdentity: () => running ? identity : null,
      signatureIsValid: () => true,
      sleep: async (milliseconds) => { now += milliseconds; },
      spawnApp: () => ({ pid: identity.processId, unref() {} }),
    });
    assert.equal(now, 16600);
    assert.equal(launched.status, "running");

    await stopStaging(manifest.manifest, {
      listAppProcesses: () => [],
      readProcessIdentity: () => running ? identity : null,
      signalProcessGroup(processGroupId, signal) {
        signals.push({ processGroupId, signal });
        running = false;
      },
      waitForExit: async () => !running,
    });
    assert.deepEqual(signals, [{ processGroupId: identity.processGroupId, signal: "SIGTERM" }]);
    restoreStaging(manifest.manifest, {
      listAppProcesses: () => [],
      resignPatchedApp() {},
      signatureIsValid: () => true,
    });
    cleanupStaging(manifest.manifest, { listAppProcesses: () => [] });
    assert.equal(existsSync(manifest.root), false);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("launch times out a never-ready listener and cleans its exact process", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let manifest;
  let now = 0;
  let running = true;
  const signals = [];
  try {
    manifest = await prepareFixture(fixture, state);
    const identity = launchedIdentity(manifest, 43126);
    await assert.rejects(
      launchStaging(manifest.manifest, {
        assertPortAvailable() {},
        listAppProcesses: () => [],
        now: () => now,
        readPortListeners: () => [],
        readProcessIdentity: () => running ? identity : null,
        signatureIsValid: () => true,
        sleep: async (milliseconds) => { now += milliseconds; },
        spawnApp: () => ({ pid: identity.processId, unref() {} }),
        signalProcessGroup(processGroupId, signal) {
          signals.push({ processGroupId, signal });
          running = false;
        },
        waitForExit: async () => !running,
      }),
      /Staging DevTools listener did not become ready/u,
    );
    assert.equal(now, 30000);
    assert.deepEqual(signals, [{ processGroupId: identity.processGroupId, signal: "SIGTERM" }]);
    assert.equal(readJson(manifest.manifest).status, "stopped");
    restoreStaging(manifest.manifest, {
      listAppProcesses: () => [],
      resignPatchedApp() {},
      signatureIsValid: () => true,
    });
    cleanupStaging(manifest.manifest, { listAppProcesses: () => [] });
    assert.equal(existsSync(manifest.root), false);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("launch rejects a foreign DevTools listener and safely stops its identified process group", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let manifest;
  try {
    manifest = await prepareFixture(fixture, state);
    const identity = launchedIdentity(manifest, 43122);
    const signals = [];
    let running = true;
    await assert.rejects(
      launchStaging(manifest.manifest, {
        assertPortAvailable() {},
        listAppProcesses: () => [],
        readAnyProcessIdentity: (processId) => ({
          processId,
          processGroupId: 99999,
          startedAt: "Thu Sep  3 12:00:01 2026",
        }),
        readPortListeners: () => [{
          processId: 99999,
          command: "foreign",
          addresses: [`127.0.0.1:${fixturePort}`],
        }],
        readProcessIdentity: () => running ? identity : null,
        signatureIsValid: () => true,
        sleep: async () => {},
        spawnApp: () => ({ pid: identity.processId, unref() {} }),
        signalProcessGroup(processGroupId, signal) {
          signals.push({ processGroupId, signal });
          running = false;
        },
        waitForExit: async () => !running,
      }),
      /listener is not owned by the launched process group/u,
    );
    assert.deepEqual(signals, [{ processGroupId: identity.processGroupId, signal: "SIGTERM" }]);
    const persisted = readJson(manifest.manifest);
    assert.equal(persisted.status, "stopped");
    assert.equal(persisted.processId, null);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("interrupted terminal launch stops, restores, and removes isolated staging", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let manifest;
  try {
    manifest = await prepareFixture(fixture, state);
    const identity = launchedIdentity(manifest, 43124);
    const controller = new AbortController();
    const signals = [];
    let running = true;
    await assert.rejects(
      launchStaging(manifest.manifest, {
        assertPortAvailable() {},
        listAppProcesses: () => [],
        readPortListeners: () => [],
        readProcessIdentity: () => running ? identity : null,
        signal: controller.signal,
        signalProcessGroup(processGroupId, signal) {
          signals.push({ processGroupId, signal });
          running = false;
        },
        signatureIsValid: () => true,
        sleep: async () => controller.abort(new Error("Interrupted by SIGHUP")),
        spawnApp: () => ({ pid: identity.processId, unref() {} }),
        waitForExit: async () => !running,
      }),
      /Interrupted by SIGHUP/u,
    );
    assert.deepEqual(signals, [{ processGroupId: identity.processGroupId, signal: "SIGTERM" }]);
    assert.equal(readJson(manifest.manifest).status, "stopped");
    restoreStaging(manifest.manifest, {
      listAppProcesses: () => [],
      resignPatchedApp() {},
      signatureIsValid: () => true,
    });
    cleanupStaging(manifest.manifest, { listAppProcesses: () => [] });
    assert.equal(existsSync(manifest.root), false);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("stop rejects PID reuse before the first signal and rechecks before escalation", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let manifest;
  try {
    manifest = await prepareFixture(fixture, state);
    const identity = launchedIdentity(manifest, 43123);
    await launchStaging(manifest.manifest, {
      assertPortAvailable() {},
      listAppProcesses: () => [],
      readAnyProcessIdentity: (processId) => ({
        processId,
        processGroupId: identity.processGroupId,
        startedAt: identity.startedAt,
      }),
      readPortListeners: () => [{
        processId: identity.processId,
        command: "staging",
        addresses: [`127.0.0.1:${fixturePort}`],
      }],
      readProcessIdentity: () => identity,
      signatureIsValid: () => true,
      sleep: async () => {},
      spawnApp: () => ({ pid: identity.processId, unref() {} }),
    });
    const signals = [];
    await assert.rejects(
      stopStaging(manifest.manifest, {
        listAppProcesses: () => [],
        readProcessIdentity: () => ({ ...identity, startedAt: "Thu Sep  3 12:01:00 2026" }),
        signalProcessGroup: (...args) => signals.push(args),
      }),
      /birth or process-group identity does not match/u,
    );
    assert.deepEqual(signals, []);

    let identityReads = 0;
    const escalationSignals = [];
    await assert.rejects(
      stopStaging(manifest.manifest, {
        listAppProcesses: () => [],
        readProcessIdentity() {
          identityReads += 1;
          return identityReads <= 3
            ? identity
            : { ...identity, startedAt: "Thu Sep  3 12:02:00 2026" };
        },
        signalProcessGroup: (processGroupId, signal) => {
          escalationSignals.push({ processGroupId, signal });
        },
        waitForExit: async () => false,
      }),
      /birth or process-group identity does not match/u,
    );
    assert.deepEqual(escalationSignals, [{
      processGroupId: identity.processGroupId,
      signal: "SIGTERM",
    }]);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("restore preserves source backups and cleanup removes only the verified staging root", async () => {
  const fixture = await createStockFixture();
  const state = {};
  let manifest;
  try {
    manifest = await prepareFixture(fixture, state);
    const backupAsar = join(manifest.sourceBackup, "app.asar");
    const backupPlist = join(manifest.sourceBackup, "Info.plist");
    const backupAsarHash = fileHash(backupAsar);
    const backupPlistHash = fileHash(backupPlist);
    assert.notEqual(fileHash(manifest.asar), backupAsarHash);

    const restored = restoreStaging(manifest.manifest, {
      listAppProcesses: () => [],
      resignPatchedApp() {},
      signatureIsValid: () => true,
    });
    assert.equal(restored.status, "restored");
    assert.equal(fileHash(manifest.asar), backupAsarHash);
    assert.equal(fileHash(backupAsar), backupAsarHash);
    assert.equal(fileHash(backupPlist), backupPlistHash);

    const removed = cleanupStaging(manifest.manifest, { listAppProcesses: () => [] });
    assert.equal(removed.status, "removed");
    assert.equal(existsSync(manifest.root), false);
  } finally {
    if (manifest?.root && existsSync(manifest.root)) {
      rmSync(manifest.root, { recursive: true, force: true });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
