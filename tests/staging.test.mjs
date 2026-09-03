import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertStagingRoot,
  assertManagedStagingPath,
  stagingBaseRoot,
  stagingBundleIdentifier,
  stagingExecutableName,
  stagingLayout,
  stagingName,
  stagingPrefix,
  stagingUnixSocketPathMaxBytes,
} from "../scripts/staging.mjs";

test("staging layout isolates every mutable root under one generated temporary directory", () => {
  const root = join(stagingBaseRoot, `${stagingPrefix}fixture`);
  const layout = stagingLayout(root, 49258);
  assert.equal(layout.app, join(root, `${stagingName}.app`));
  assert.equal(layout.executable, join(layout.app, "Contents", "MacOS", stagingExecutableName));
  assert.equal(layout.devToolsPort, 49258);
  assert.equal(new Set([
    layout.userData,
    layout.codexHome,
    layout.workflowRoot,
    layout.settings,
    layout.logs,
    layout.journal,
    layout.updates,
    layout.updateState,
    layout.backups,
  ]).size, 9);
  for (const target of Object.values(layout).filter((value) => typeof value === "string")) {
    assert.ok(target === root || target.startsWith(`${root}/`));
  }
  assert.equal(stagingBundleIdentifier, "com.openai.codex.workflow-staging.v2690120858");
  assert.ok(
    Buffer.byteLength(join(layout.codexHome, "ipc", "ipc.sock")) <= stagingUnixSocketPathMaxBytes,
  );
});

test("managed staging paths reject traversal and symlink redirection", () => {
  const root = mkdtempSync(join(stagingBaseRoot, stagingPrefix));
  try {
    mkdirSync(join(root, "state"));
    symlinkSync("/Applications", join(root, "state", "redirect"));
    assert.throws(
      () => assertManagedStagingPath(root, "/Applications/ChatGPT.app"),
      /escapes its generated root/u,
    );
    assert.throws(
      () => assertManagedStagingPath(root, join(root, "state", "redirect", "ChatGPT.app")),
      /must not contain symbolic links/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
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
