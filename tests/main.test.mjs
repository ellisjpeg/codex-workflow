import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Script, createContext } from "node:vm";
import test from "node:test";

const mainSource = readFileSync(new URL("../runtime/main.cjs", import.meta.url), "utf8");

function loadSettings(rawSettings) {
  const handlers = new Map();
  const settingsPath = "/tmp/codex-workflow-main-test/settings.json";
  const context = createContext({
    process: {
      env: { CODEX_WORKFLOW_ROOT: "/tmp/codex-workflow-main-test" },
      pid: 123,
    },
    require(name) {
      if (name === "electron") {
        return {
          app: {
            getVersion: () => "test",
            on() {},
            quit() {},
            whenReady: () => ({ then() {} }),
          },
          ipcMain: {
            handle(channel, handler) {
              handlers.set(channel, handler);
            },
            on() {},
          },
          session: { defaultSession: {} },
          webContents: { getAllWebContents: () => [] },
        };
      }
      if (name === "node:child_process") return { spawn() { throw new Error("Unexpected spawn"); } };
      if (name === "node:crypto") return { randomUUID: () => "test" };
      if (name === "node:path") return path;
      if (name === "node:fs") {
        return {
          appendFileSync() {},
          existsSync(target) {
            return target === settingsPath;
          },
          mkdirSync() {},
          readFileSync(target) {
            if (target === settingsPath) return JSON.stringify(rawSettings);
            throw new Error(`Unexpected read: ${target}`);
          },
          statSync() {
            return { size: 0 };
          },
        };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  new Script(mainSource, { filename: "main.cjs" }).runInContext(context);
  const handler = handlers.get("codex-workflow:settings:get");
  return JSON.parse(JSON.stringify(
    handler({ senderFrame: { url: "app://codex/settings" } }),
  ));
}

test("main settings normalizer migrates legacy Efficiency mode", () => {
  assert.deepEqual(
    loadSettings({ schemaVersion: 1, efficiencyMode: false }),
    {
      schemaVersion: 2,
      focusedInterface: false,
      hidePullRequests: true,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
    },
  );
});

test("main settings normalizer accepts only canonical booleans", () => {
  assert.deepEqual(
    loadSettings({
      schemaVersion: 2,
      focusedInterface: "yes",
      efficiencyMode: false,
      hidePullRequests: false,
      hidePetMenuItem: 1,
      hideInviteFriendMenuItem: "yes",
      replaceHelpWithSettings: 0,
    }),
    {
      schemaVersion: 2,
      focusedInterface: false,
      hidePullRequests: false,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
    },
  );
});

test("Settings activation sends a bounded trusted mouse click", () => {
  const harness = createUpdateHarness(new Map());
  const inputEvents = [];
  const sender = {
    getOwnerBrowserWindow: () => ({ getContentSize: () => [1200, 800] }),
    getURL: () => "app://codex/thread",
    isDestroyed: () => false,
    sendInputEvent: (event) => inputEvents.push(event),
  };
  const activate = harness.handlers.get("codex-workflow:settings:activate");
  assert.equal(activate(
    { sender, senderFrame: { url: "app://codex/thread" } },
    { target: "settings-item", x: 32, y: 744 },
  ), true);
  assert.deepEqual(JSON.parse(JSON.stringify(inputEvents)), [
    { type: "mouseMove", x: 32, y: 744 },
    { type: "mouseDown", x: 32, y: 744, button: "left", clickCount: 1 },
    { type: "mouseUp", x: 32, y: 744, button: "left", clickCount: 1 },
  ]);
  assert.throws(
    () => activate(
      { sender, senderFrame: { url: "app://codex/thread" } },
      { target: "settings-item", x: 1200, y: 744 },
    ),
    /invalid Settings coordinates/u,
  );
  assert.throws(
    () => activate(
      { sender, senderFrame: { url: "https://example.com" } },
      { target: "settings-item", x: 32, y: 744 },
    ),
    /untrusted renderer/u,
  );
});

function createUpdateHarness(files, runtimeRoot = "/tmp/codex-workflow-main-update-test") {
  const handlers = new Map();
  const spawned = [];
  const timeoutCallbacks = [];
  let quitCount = 0;
  let exitCount = 0;
  let relaunchCount = 0;
  const context = createContext({
    setImmediate,
    setTimeout(callback, delay) {
      const timer = { callback, delay, unrefCalled: false, unref() { this.unrefCalled = true; } };
      timeoutCallbacks.push(timer);
      return timer;
    },
    process: {
      env: { CODEX_WORKFLOW_ROOT: runtimeRoot },
      execPath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      pid: 456,
    },
    require(name) {
      if (name === "electron") {
        return {
          app: {
            getVersion: () => "test",
            on() {},
            quit() { quitCount += 1; },
            exit() { exitCount += 1; },
            relaunch() { relaunchCount += 1; },
            whenReady: () => ({ then() {} }),
          },
          ipcMain: {
            handle(channel, handler) { handlers.set(channel, handler); },
            on() {},
          },
          session: { defaultSession: {} },
          webContents: { getAllWebContents: () => [] },
        };
      }
      if (name === "node:child_process") {
        return {
          spawn(executable, args, options) {
            const call = { executable, args, options, unref: false };
            spawned.push(call);
            return {
              pid: 789,
              once(event, callback) {
                if (event === "close") queueMicrotask(() => callback(0, null));
              },
              unref() { call.unref = true; },
            };
          },
        };
      }
      if (name === "node:crypto") return { randomUUID: () => "test" };
      if (name === "node:path") return path;
      if (name === "node:fs") {
        return {
          appendFileSync() {},
          existsSync(target) { return files.has(target); },
          mkdirSync() {},
          readFileSync(target) {
            if (files.has(target)) return files.get(target);
            throw new Error(`Unexpected read: ${target}`);
          },
          statSync() { return { size: 0 }; },
        };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  new Script(mainSource, { filename: "main.cjs" }).runInContext(context);
  return {
    handlers,
    spawned,
    timeoutCallbacks,
    trusted: { senderFrame: { url: "app://codex/thread" } },
    quitCount: () => quitCount,
    exitCount: () => exitCount,
    relaunchCount: () => relaunchCount,
  };
}

test("Workflow Update installs the external runtime before relaunching", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-update-test";
  const stagedRoot = path.join(runtimeRoot, "updates", "0.5.0");
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      nodeExecutable: "/opt/node/bin/node",
    })],
    [path.join(runtimeRoot, "state.json"), JSON.stringify({ patchVersion: "0.4.4" })],
    [path.join(runtimeRoot, "update-state.json"), JSON.stringify({
      availableVersion: "0.5.0",
      stagedSourceRoot: stagedRoot,
    })],
    [path.join(stagedRoot, "package.json"), JSON.stringify({
      name: "codex-workflow",
      version: "0.5.0",
    })],
    [path.join(stagedRoot, "scripts", "install.mjs"), ""],
    [path.join(stagedRoot, "scripts", "install-runtime.mjs"), ""],
    ["/opt/node/bin/node", ""],
  ]);
  const harness = createUpdateHarness(files, runtimeRoot);
  const status = harness.handlers.get("codex-workflow:update:get")(harness.trusted);
  assert.equal(status.available, true);
  assert.equal(status.availableVersion, "0.5.0");
  assert.equal(status.blockedReason, null);

  const result = await harness.handlers.get("codex-workflow:update:install")(harness.trusted);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.applying, true);
  assert.equal(harness.spawned.length, 1);
  assert.equal(harness.spawned[0].executable, "/opt/node/bin/node");
  assert.equal(harness.spawned[0].options.detached, undefined);
  assert.equal(harness.spawned[0].options.env.CODEX_WORKFLOW_ROOT, runtimeRoot);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.spawned[0].args.slice(1))),
    ["--apply"],
  );
  assert.equal(harness.spawned[0].unref, false);
  assert.equal(harness.quitCount(), 0);
  assert.equal(harness.relaunchCount(), 1);
  assert.equal(harness.exitCount(), 1);
  assert.equal(harness.timeoutCallbacks.length, 0);
  await assert.rejects(
    harness.handlers.get("codex-workflow:update:install")({ senderFrame: { url: "https://example.com" } }),
    /untrusted renderer/u,
  );
});

test("Workflow Update ignores a newer local checkout", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-local-drift-test";
  const sourceRoot = "/tmp/codex-workflow-source-test";
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      sourceRoot,
      nodeExecutable: "/opt/node/bin/node",
    })],
    [path.join(runtimeRoot, "state.json"), JSON.stringify({ patchVersion: "0.5.3" })],
    [path.join(sourceRoot, "package.json"), JSON.stringify({
      name: "codex-workflow",
      version: "0.5.4",
    })],
    [path.join(sourceRoot, "scripts", "install.mjs"), ""],
    ["/opt/node/bin/node", ""],
  ]);
  const harness = createUpdateHarness(files, runtimeRoot);
  const status = harness.handlers.get("codex-workflow:update:get")(harness.trusted);
  assert.equal(status.available, false);
  assert.equal(status.availableVersion, null);

  const result = await harness.handlers.get("codex-workflow:update:install")(harness.trusted);
  assert.equal(result.available, false);
  assert.equal(harness.spawned.length, 0);
  assert.equal(harness.quitCount(), 0);
});

test("Workflow Update does not quit while patch recovery is pending", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-recovery-test";
  const stagedRoot = path.join(runtimeRoot, "updates", "0.5.0");
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      nodeExecutable: "/opt/node/bin/node",
    })],
    [path.join(runtimeRoot, "state.json"), JSON.stringify({ patchVersion: "0.4.4" })],
    [path.join(runtimeRoot, "transaction.json"), "{}"],
    [path.join(runtimeRoot, "update-state.json"), JSON.stringify({
      availableVersion: "0.5.0",
      stagedSourceRoot: stagedRoot,
    })],
    [path.join(stagedRoot, "package.json"), JSON.stringify({
      name: "codex-workflow",
      version: "0.5.0",
    })],
    [path.join(stagedRoot, "scripts", "install.mjs"), ""],
    [path.join(stagedRoot, "scripts", "install-runtime.mjs"), ""],
    ["/opt/node/bin/node", ""],
  ]);
  const harness = createUpdateHarness(files, runtimeRoot);
  const status = harness.handlers.get("codex-workflow:update:get")(harness.trusted);
  assert.equal(status.available, false);
  assert.equal(status.availableVersion, "0.5.0");
  assert.equal(status.blockedReason, "recovery-required");

  const result = await harness.handlers.get("codex-workflow:update:install")(harness.trusted);
  assert.equal(result.available, false);
  assert.equal(harness.spawned.length, 0);
  assert.equal(harness.quitCount(), 0);
});
