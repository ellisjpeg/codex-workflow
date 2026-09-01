import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.CODEX_WORKFLOW_ROOT = "/tmp/codex-workflow-updater-test";
const require = createRequire(import.meta.url);
const { checkRemote, compareVersions, remoteCheckDue, selectStagedCandidate, validateTarEntries, validateTarTypes, waitForProcessExit } = require("../runtime/updater.cjs");

test("updater compares canonical release versions", () => {
  assert.equal(compareVersions("0.5.0", "0.4.4"), 1);
  assert.equal(compareVersions("0.5.0", "0.5.0"), 0);
  assert.equal(compareVersions("0.4.4", "0.5.0"), -1);
  assert.equal(compareVersions("main", "0.5.0"), 0);
});

test("updater limits remote checks to five-minute intervals", () => {
  const now = Date.parse("2026-08-31T20:00:00.000Z");
  assert.equal(remoteCheckDue({}, now), true);
  assert.equal(remoteCheckDue({ remoteCheckedAt: "2026-08-31T19:56:00.001Z" }, now), false);
  assert.equal(remoteCheckDue({ remoteCheckedAt: "2026-08-31T19:55:00.000Z" }, now), true);
});

test("updater treats an absent parent process as already stopped", async () => {
  assert.equal(await waitForProcessExit(null, 1), true);
});

test("updater uses release ETags and accepts an unchanged response", async () => {
  const originalFetch = globalThis.fetch;
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-updater-etag-test-"));
  const releaseRoot = join(root, "updates", "0.5.4");
  mkdirSync(join(releaseRoot, "scripts"), { recursive: true });
  writeFileSync(join(releaseRoot, "package.json"), `${JSON.stringify({
    name: "codex-workflow",
    version: "0.5.4",
  })}\n`);
  writeFileSync(join(releaseRoot, "scripts", "install.mjs"), "");
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { status: 304, ok: false };
  };
  try {
    assert.deepEqual(
      await checkRemote(
        { releaseApi: "https://api.github.test/releases/latest" },
        {
          releaseEtag: '"release-1"',
          availableVersion: "0.5.4",
          stagedSourceRoot: releaseRoot,
        },
      ),
      { candidate: null, etag: '"release-1"', unchanged: true },
    );
    assert.equal(request.options.headers["If-None-Match"], '"release-1"');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("updater bypasses a stale ETag when its staged release is missing", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { status: 404, ok: false };
  };
  try {
    await checkRemote(
      { releaseApi: "https://api.github.test/releases/latest" },
      { releaseEtag: '"release-1"', availableVersion: "0.5.4", stagedSourceRoot: null },
    );
    assert.equal(request.options.headers["If-None-Match"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updater treats a repository without releases as up to date", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 404, ok: false });
  try {
    assert.deepEqual(
      await checkRemote({ releaseApi: "https://api.github.test/releases/latest" }, {}),
      { candidate: null, etag: null, unchanged: false },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updater selects only a matching staged release", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-updater-test-"));
  try {
    const releaseRoot = join(root, "updates", "0.5.4");
    mkdirSync(join(releaseRoot, "scripts"), { recursive: true });
    writeFileSync(join(releaseRoot, "package.json"), `${JSON.stringify({
      name: "codex-workflow",
      version: "0.5.4",
    })}\n`);
    writeFileSync(join(releaseRoot, "scripts", "install.mjs"), "");

    assert.deepEqual(
      selectStagedCandidate({
        availableVersion: "0.5.4",
        stagedSourceRoot: releaseRoot,
      }, "0.5.3"),
      {
        root: releaseRoot,
        version: "0.5.4",
        installPath: join(releaseRoot, "scripts", "install.mjs"),
      },
    );
    assert.equal(selectStagedCandidate({ sourceRoot: releaseRoot }, "0.5.3"), null);
    assert.equal(selectStagedCandidate({
      availableVersion: "0.5.5",
      stagedSourceRoot: releaseRoot,
    }, "0.5.3"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updater rejects archive traversal", () => {
  assert.doesNotThrow(() => validateTarEntries("codex-workflow/package.json\ncodex-workflow/runtime/main.cjs\n"));
  assert.throws(() => validateTarEntries("../escape\n"), /unsafe path/u);
  assert.throws(() => validateTarEntries("/absolute/path\n"), /unsafe path/u);
});

test("updater rejects links and special archive entries", () => {
  assert.doesNotThrow(() => validateTarTypes("drwxr-xr-x root/wheel 0 directory\n-rw-r--r-- root/wheel 1 file\n"));
  assert.throws(() => validateTarTypes("lrwxr-xr-x root/wheel 0 link -> /tmp\n"), /unsupported entry type/u);
});
