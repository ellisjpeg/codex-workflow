import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { releaseFiles, stageRelease } from "../scripts/stage-release.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(source, "package.json"))).version;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "workflow-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("updater asset contains only active runtime and locked production dependencies with licences", async t => {
  const root = fixture(t);
  const target = join(root, `codex-workflow-${version}`);
  const lockBefore = readFileSync(join(source, "package-lock.json"));
  // Name this independently of the allowlist so deleting it there fails a test.
  const noticeFile = "THIRD_PARTY_NOTICES.md";
  assert.ok(releaseFiles.includes(noticeFile), "embedded icon notices must ship in the updater asset");
  const result = stageRelease(source, target, version);
  assert.equal(result.version, version);
  const notices = readFileSync(join(target, noticeFile), "utf8");
  assert.equal(notices, readFileSync(join(source, noticeFile), "utf8"));
  assert.match(notices, /Copyright \(c\) 2026 Lucide Icons and Contributors/u);
  assert.match(notices, /Copyright \(c\) 2013-present Cole Bemis/u);
  assert.match(notices, /Lucide Contributors 2022/u);
  assert.match(notices, /ISC License/u);
  assert.match(notices, /The MIT License \(MIT\)/u);
  assert.deepEqual(readdirSync(join(target, "runtime")).sort(), ["main.cjs", "preload.cjs", "updater.cjs"]);
  assert.equal(existsSync(join(target, "node_modules/jsdom")), false);
  assert.equal(existsSync(join(target, "parked")), false);
  assert.equal(existsSync(join(target, "tests")), false);
  assert.equal(existsSync(join(target, "scripts/staging.mjs")), false);
  assert.equal(existsSync(join(target, "scripts/staging-updater-disabled.cjs")), false);
  const setupImport = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `await import(${JSON.stringify(pathToFileURL(join(target, "scripts/setup.mjs")).href)});`,
    encoding: "utf8",
  });
  assert.equal(setupImport.status, 0, setupImport.stderr);
  for (const file of releaseFiles) assert.deepEqual(readFileSync(join(target, file)), readFileSync(join(source, file)));
  const lock = JSON.parse(lockBefore);
  const dependencies = Object.entries(lock.packages).filter(([name, pkg]) => name && !pkg.dev);
  assert.equal(result.dependencies, dependencies.length);
  for (const [name, pkg] of dependencies) {
    assert.equal(JSON.parse(readFileSync(join(target, name, "package.json"))).version, pkg.version);
    const notices = readdirSync(join(source, name)).filter(file => /^(licen[cs]e|notice|copying)/iu.test(file));
    assert.ok(notices.length, `Review missing licence notice: ${name}`);
    for (const file of notices) assert.deepEqual(readFileSync(join(target, name, file)), readFileSync(join(source, name, file)));
  }
  // Exercise the packaged dependency closure, rather than resolving back to the checkout.
  const packagedRequire = createRequire(join(target, "package.json"));
  const asarPath = packagedRequire.resolve("@electron/asar");
  assert.ok(asarPath.startsWith(`${realpathSync(target)}/`));
  const asar = await import(pathToFileURL(asarPath));
  const input = join(root, "asar-source");
  mkdirSync(input);
  writeFileSync(join(input, "payload.txt"), "packaged dependency smoke test");
  await asar.createPackage(input, join(root, "smoke.asar"));
  assert.equal(asar.extractFile(join(root, "smoke.asar"), "payload.txt").toString(), "packaged dependency smoke test");
  const archive = join(root, "release.tar.gz");
  const packed = spawnSync("/usr/bin/tar", ["-czf", archive, "-C", root, `codex-workflow-${version}`], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const types = spawnSync("/usr/bin/tar", ["-tvzf", archive], { encoding: "utf8" });
  assert.equal(types.status, 0, types.stderr);
  assert.ok(types.stdout.trim().split("\n").every(line => ["-", "d"].includes(line[0])));
  const archivedNotice = spawnSync("/usr/bin/tar", ["-xOzf", archive, `codex-workflow-${version}/${noticeFile}`], { encoding: "utf8" });
  assert.equal(archivedNotice.status, 0, archivedNotice.stderr);
  assert.equal(archivedNotice.stdout, notices);
  assert.deepEqual(readFileSync(join(source, "package-lock.json")), lockBefore);
  assert.ok(existsSync(join(source, "node_modules/jsdom/package.json")), "do not prune the contributor's installation");
});

test("release staging refuses a missing embedded-icon notice and cleans partial output", t => {
  const root = fixture(t);
  const candidate = join(root, "source");
  for (const file of releaseFiles) {
    if (file === "THIRD_PARTY_NOTICES.md") continue;
    mkdirSync(dirname(join(candidate, file)), { recursive: true });
    copyFileSync(join(source, file), join(candidate, file));
  }
  const target = join(root, "asset");
  assert.throws(() => stageRelease(candidate, target, version), /ENOENT.*THIRD_PARTY_NOTICES\.md/u);
  assert.equal(existsSync(target), false);
});

test("release staging rejects metadata drift and never overwrites an existing directory", t => {
  const root = fixture(t);
  const target = join(root, "asset");
  for (const invalid of ["0.0.0", "1.0.0-../../escape", "1.0.0-01", "1.0.0\n", null]) {
    assert.throws(() => stageRelease(source, target, invalid), /metadata must agree/u);
    assert.equal(existsSync(target), false);
  }
  mkdirSync(target);
  writeFileSync(join(target, "keep"), "existing destination");
  assert.throws(() => stageRelease(source, target, version), /EEXIST/u);
  assert.equal(readFileSync(join(target, "keep"), "utf8"), "existing destination");
});

test("release staging fails closed on linked payloads and mismatched installed dependencies", t => {
  const root = fixture(t);
  const candidate = join(root, "source");
  for (const file of releaseFiles) {
    mkdirSync(dirname(join(candidate, file)), { recursive: true });
    copyFileSync(join(source, file), join(candidate, file));
  }
  const target = join(root, "asset");
  const linked = join(candidate, "runtime/main.cjs");
  unlinkSync(linked);
  symlinkSync(join(source, "runtime/main.cjs"), linked);
  assert.throws(() => stageRelease(candidate, target, version), /not a regular file/u);
  assert.equal(existsSync(target), false);
  unlinkSync(linked);
  copyFileSync(join(source, "runtime/main.cjs"), linked);
  const dependency = join(candidate, "node_modules/@electron/asar");
  mkdirSync(dependency, { recursive: true });
  writeFileSync(join(dependency, "package.json"), '{"version":"0.0.0"}');
  assert.throws(() => stageRelease(candidate, target, version), /does not match the lockfile/u);
  assert.equal(existsSync(target), false);
  const lockPath = join(candidate, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath));
  lock.version = "0.0.0";
  writeFileSync(lockPath, JSON.stringify(lock));
  assert.throws(() => stageRelease(candidate, target, version), /metadata must agree/u);
  assert.equal(existsSync(target), false);
  // Invalid versions must fail even when every metadata file agrees with them.
  const packagePath = join(candidate, "package.json");
  const manifestPath = join(candidate, "workflow-compatibility.json");
  const pkg = JSON.parse(readFileSync(packagePath));
  const manifest = JSON.parse(readFileSync(manifestPath));
  for (const value of ["1.0.0-01", "1.0.0-../../../escape", "1.0.0\n", "9007199254740992.0.0", "1.0.0-rc.1+build.001"]) {
    pkg.version = lock.version = lock.packages[""].version = manifest.workflowVersion = value;
    writeFileSync(packagePath, JSON.stringify(pkg));
    writeFileSync(lockPath, JSON.stringify(lock));
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const error = value === "1.0.0-rc.1+build.001" ? /does not match the lockfile/u : /metadata must agree/u;
    assert.throws(() => stageRelease(candidate, target, value), error);
    assert.equal(existsSync(target), false);
  }
});
