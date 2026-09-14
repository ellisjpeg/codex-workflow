import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { releaseDraftArguments } from "../scripts/release-draft.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(t, version = "0.5.42-alpha.1") {
  const root = mkdtempSync(join(tmpdir(), "workflow-draft-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const metadata = { name: "codex-workflow", version };
  writeFileSync(join(root, "package.json"), JSON.stringify(metadata));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ ...metadata, lockfileVersion: 3, packages: { "": metadata } }));
  writeFileSync(join(root, "workflow-compatibility.json"), JSON.stringify({ schemaVersion: 1, workflowVersion: version }));
  const notes = join(root, "docs", "releases", `${version}.md`);
  mkdirSync(dirname(notes), { recursive: true });
  writeFileSync(notes, "# Reviewed release notes\n");
  const archive = join(root, `codex-workflow-${version}.tar.gz`);
  // Archive contents are covered by release.test.mjs; this tests command policy.
  writeFileSync(archive, "asset fixture");
  return { root, version, tag: `v${version}`, archive, notes };
}

test("all releases are drafts; only the SemVer prerelease field enables prerelease", t => {
  for (const [version, prerelease] of [["0.5.42-alpha.1", true], ["1.0.0-rc.1+build.001", true], ["1.0.0", false], ["1.0.0+build-alpha", false]]) {
    const f = fixture(t, version);
    const args = releaseDraftArguments(f.root, f.tag, f.archive);
    assert.deepEqual(args, ["release", "create", f.tag, f.archive,
      "--draft", "--latest=false", "--verify-tag", "--title", `Workflow ${version}`,
      "--notes-file", f.notes, ...(prerelease ? ["--prerelease"] : [])]);
  }
});

test("draft creation rejects malformed, unsafe and mismatched tags", t => {
  const f = fixture(t);
  for (const tag of [undefined, null, 42, "", "0.5.42-alpha.1", "v0.5.42", "v01.0.0", "v1.0.0-01", "v1.0.0\n", "v9007199254740992.0.0", "v1.0.0-../../escape", "v1.0.0;echo unsafe"]) {
    assert.throws(() => releaseDraftArguments(f.root, tag, f.archive), /tag must|metadata must agree/u);
  }
  const lock = JSON.parse(readFileSync(join(f.root, "package-lock.json")));
  lock.packages[""].version = "0.5.41";
  writeFileSync(join(f.root, "package-lock.json"), JSON.stringify(lock));
  assert.throws(() => releaseDraftArguments(f.root, f.tag, f.archive), /metadata must agree/u);
});

test("draft creation requires the exact asset name, regular asset and version-specific notes", t => {
  const f = fixture(t);
  assert.throws(() => releaseDraftArguments(f.root, f.tag, join(f.root, "wrong.tar.gz")), /filename must match/u);
  unlinkSync(f.archive);
  assert.throws(() => releaseDraftArguments(f.root, f.tag, f.archive), /ENOENT/u);
  symlinkSync(f.notes, f.archive);
  assert.throws(() => releaseDraftArguments(f.root, f.tag, f.archive), /not a regular file/u);
  unlinkSync(f.archive);
  mkdirSync(f.archive);
  assert.throws(() => releaseDraftArguments(f.root, f.tag, f.archive), /not a regular file/u);
  rmSync(f.archive, { recursive: true });
  writeFileSync(f.archive, "asset fixture");
  unlinkSync(f.notes);
  assert.throws(() => releaseDraftArguments(f.root, f.tag, f.archive), /ENOENT/u);
  symlinkSync(f.archive, f.notes);
  assert.throws(() => releaseDraftArguments(f.root, f.tag, f.archive), /not a regular file/u);
});

test("draft CLI executes only the validated draft arguments and propagates gh failures", t => {
  const f = fixture(t);
  const scripts = join(f.root, "scripts");
  mkdirSync(scripts);
  for (const name of ["release-draft.mjs", "stage-release.mjs"]) copyFileSync(join(source, "scripts", name), join(scripts, name));
  const bin = join(f.root, "fake-bin");
  mkdirSync(bin);
  const capture = join(f.root, "arguments.txt");
  writeFileSync(join(bin, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$GH_TEST_CAPTURE"\nexit "$GH_TEST_EXIT"\n', { mode: 0o700 });
  // PATH cannot find a real gh: these tests never contact GitHub or need tokens.
  const env = { ...process.env, PATH: bin, GH_TEST_CAPTURE: capture, GH_TEST_EXIT: "0" };
  const cli = join(scripts, "release-draft.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: f.root, env, encoding: "utf8" });
  const result = run(f.tag, f.archive);
  assert.equal(result.status, 0, result.stderr);
  // The CLI derives its source from import.meta.url, which resolves macOS aliases.
  assert.deepEqual(readFileSync(capture, "utf8").trimEnd().split("\n"), releaseDraftArguments(realpathSync(f.root), f.tag, f.archive));
  env.GH_TEST_EXIT = "7";
  assert.equal(run(f.tag, f.archive).status, 7);
  unlinkSync(capture);
  assert.notEqual(run("v0.5.42", f.archive).status, 0);
  assert.notEqual(run(f.tag, f.archive, "--publish").status, 0);
  assert.equal(existsSync(capture), false, "invalid input must never reach gh");
  const badBuild = spawnSync(process.execPath, [join(scripts, "stage-release.mjs"), "0.0.0", join(f.root, "bad-asset")], { cwd: f.root, env, encoding: "utf8" });
  assert.notEqual(badBuild.status, 0, "the archive builder must execute even through a temporary-directory alias");
  assert.match(badBuild.stderr, /metadata must agree/u);
  unlinkSync(join(bin, "gh"));
  assert.notEqual(run(f.tag, f.archive).status, 0, "missing gh is not success");
});

test("release helpers can be imported from stdin without running a command", () => {
  const urls = ["release-draft.mjs", "stage-release.mjs"].map(name => pathToFileURL(join(source, "scripts", name)).href);
  const input = urls.map(url => `await import(${JSON.stringify(url)});`).join("\n") + '\nconsole.log("imports-only");';
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], { input, encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "imports-only");
});

test("the tag workflow creates a draft only after checks and packaging", () => {
  const workflow = readFileSync(join(source, ".github/workflows/release.yml"), "utf8");
  const draft = 'node scripts/release-draft.mjs "$GITHUB_REF_NAME" "dist/codex-workflow-$version.tar.gz"';
  assert.ok(workflow.includes(draft));
  const positions = ["npm run check", "node scripts/stage-release.mjs", "tar -C dist/stage", draft].map(step => workflow.indexOf(step));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
  assert.doesNotMatch(workflow, /gh release (create|edit|delete)|--draft=false|--latest=true/u);
});

test("alpha docs pin the install tag, disable repair explicitly and keep package metadata aligned", () => {
  const version = JSON.parse(readFileSync(join(source, "package.json"))).version;
  const readme = readFileSync(join(source, "README.md"), "utf8");
  const notes = readFileSync(join(source, "docs", "releases", `${version}.md`), "utf8");
  for (const text of [readme, notes]) {
    assert.ok(text.includes(`--branch v${version}`));
    assert.ok(text.includes("npm run setup -- --no-auto-repair"));
    assert.ok(text.includes("npm run uninstall:patch"));
  }
  const lock = JSON.parse(readFileSync(join(source, "package-lock.json")));
  const manifest = JSON.parse(readFileSync(join(source, "workflow-compatibility.json")));
  assert.deepEqual([lock.version, lock.packages[""].version, manifest.workflowVersion], [version, version, version]);
});
