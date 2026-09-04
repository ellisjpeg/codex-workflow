import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Script, createContext } from "node:vm";
import test from "node:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";

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
      hiddenSettingsPages: [],
      hidePullRequests: true,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
      hideComposerMicrophone: false,
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
      hideComposerMicrophone: "yes",
    }),
    {
      schemaVersion: 2,
      focusedInterface: false,
      hidePullRequests: false,
      hidePetMenuItem: true,
      hiddenSettingsPages: [],
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
      hideComposerMicrophone: false,
    },
  );
  assert.equal(loadSettings({ hideComposerMicrophone: true }).hideComposerMicrophone, true);
});

test("hidden settings pages normalize, persist atomically, and survive another main process", () => {
  assert.deepEqual(loadSettings({ hiddenSettingsPages: "appearance" }).hiddenSettingsPages, []);
  assert.deepEqual(loadSettings({ hiddenSettingsPages: ["workflow", "appearance", "appearance", null, {}, "../bad"] }).hiddenSettingsPages, ["appearance"]);
  assert.equal(loadSettings({ hiddenSettingsPages: Array.from({ length: 120 }, (_, index) => `page-${index}`) }).hiddenSettingsPages.length, 100);
  const root = fs.mkdtempSync(path.join(tmpdir(), "workflow-sidebar-settings-"));
  try {
    const harness = createUpdateHarness(new Map(), root, fs);
    const write = harness.handlers.get("codex-workflow:settings:set");
    write(harness.trusted, { hideComposerMicrophone: true, hiddenSettingsPages: ["appearance", "workflow"] });
    const settingsPath = path.join(root, "settings.json");
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.deepEqual(saved.hiddenSettingsPages, ["appearance"]);
    assert.equal(saved.hideComposerMicrophone, true);
    assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);
    const reopened = createUpdateHarness(new Map(), root, fs);
    assert.deepEqual(JSON.parse(JSON.stringify(reopened.handlers.get("codex-workflow:settings:get")(harness.trusted))), saved);
    assert.throws(() => write({ senderFrame: { url: "https://example.com" } }, { hiddenSettingsPages: [] }), /untrusted renderer/u);
    write(harness.trusted, { hiddenSettingsPages: [] });
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, "utf8")).hiddenSettingsPages, []);
    assert.equal(fs.readdirSync(root).some((entry) => entry.startsWith(".settings-")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Settings activation sends the native shortcut without moving the pointer", () => {
  const harness = createUpdateHarness(new Map());
  const inputEvents = [];
  const sender = {
    getURL: () => "app://codex/thread",
    isDestroyed: () => false,
    sendInputEvent: (event) => inputEvents.push(event),
  };
  const activate = harness.handlers.get("codex-workflow:settings:activate");
  assert.equal(activate(
    { sender, senderFrame: { url: "app://codex/thread" } },
    { target: "keyboard-shortcut" },
  ), true);
  assert.deepEqual(JSON.parse(JSON.stringify(inputEvents)), [
    { type: "keyDown", keyCode: ",", modifiers: ["meta"] },
    { type: "keyUp", keyCode: ",", modifiers: ["meta"] },
  ]);
  assert.throws(
    () => activate(
      { sender, senderFrame: { url: "app://codex/thread" } },
      { target: "settings-item" },
    ),
    /invalid Settings activation/u,
  );
  assert.throws(
    () => activate(
      { sender, senderFrame: { url: "https://example.com" } },
      { target: "keyboard-shortcut" },
    ),
    /untrusted renderer/u,
  );
});

function createUpdateHarness(files, runtimeRoot = "/tmp/codex-workflow-main-update-test", fileSystem) {
  const handlers = new Map();
  const appListeners = new Map();
  const readyCallbacks = [];
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
            on(event, callback) { appListeners.set(event, callback); },
            quit() { quitCount += 1; },
            exit() { exitCount += 1; },
            relaunch() { relaunchCount += 1; },
            whenReady: () => ({ then(callback) { readyCallbacks.push(callback); } }),
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
        if (fileSystem) return fileSystem;
        return {
          appendFileSync() {},
          existsSync(target) { return files.has(target); },
          mkdirSync() {},
          readFileSync(target) {
            if (files.has(target)) return files.get(target);
            throw new Error(`Unexpected read: ${target}`);
          },
          statSync() { return { size: 0 }; },
          watch() { return { close() {} }; },
        };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  new Script(mainSource, { filename: "main.cjs" }).runInContext(context);
  return {
    handlers,
    appListeners,
    readyCallbacks,
    spawned,
    timeoutCallbacks,
    trusted: { senderFrame: { url: "app://codex/thread" } },
    quitCount: () => quitCount,
    exitCount: () => exitCount,
    relaunchCount: () => relaunchCount,
  };
}

const compatibilityConfig = {
  codexVersion: "26.901.31953",
  codexBuild: "7868",
  bundleIdentifier: "com.openai.codex",
  packageName: "openai-codex-electron",
};

function releaseManifest(version) {
  return JSON.stringify({
    schemaVersion: 1,
    workflowVersion: version,
    ...compatibilityConfig,
  });
}

test("Workflow Update installs the external runtime before relaunching", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-update-test";
  const stagedRoot = path.join(runtimeRoot, "updates", "0.5.0");
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      nodeExecutable: "/opt/node/bin/node",
      ...compatibilityConfig,
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
    [path.join(stagedRoot, "workflow-compatibility.json"), releaseManifest("0.5.0")],
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

test("update discovery runs at startup and visibility only when backoff is due", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-check-test";
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      nodeExecutable: "/opt/node/bin/node",
      ...compatibilityConfig,
    })],
    [path.join(runtimeRoot, "update-state.json"), JSON.stringify({})],
    ["/opt/node/bin/node", ""],
  ]);
  const harness = createUpdateHarness(files, runtimeRoot);
  assert.equal(harness.readyCallbacks.length, 1);
  harness.readyCallbacks[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.spawned.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.spawned[0].args)), [
    path.join(runtimeRoot, "runtime", "updater.cjs"),
    "--check",
  ]);
  files.set(path.join(runtimeRoot, "update-state.json"), JSON.stringify({
    nextRemoteCheckAt: new Date(Date.now() + 60_000).toISOString(),
  }));
  harness.appListeners.get("browser-window-focus")();
  assert.equal(harness.spawned.length, 1);
});

test("Workflow Update ignores a newer local checkout", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-local-drift-test";
  const sourceRoot = "/tmp/codex-workflow-source-test";
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      sourceRoot,
      nodeExecutable: "/opt/node/bin/node",
      ...compatibilityConfig,
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

test("Workflow Update is unavailable when isolated staging disables updates", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-staging-test";
  const stagedRoot = path.join(runtimeRoot, "updates", "0.5.11");
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      nodeExecutable: "/opt/node/bin/node",
      updatesDisabled: true,
      ...compatibilityConfig,
    })],
    [path.join(runtimeRoot, "state.json"), JSON.stringify({ patchVersion: "0.5.10" })],
    [path.join(runtimeRoot, "update-state.json"), JSON.stringify({
      availableVersion: "0.5.11",
      stagedSourceRoot: stagedRoot,
    })],
    [path.join(stagedRoot, "package.json"), JSON.stringify({
      name: "codex-workflow",
      version: "0.5.11",
    })],
    [path.join(stagedRoot, "workflow-compatibility.json"), releaseManifest("0.5.11")],
    [path.join(stagedRoot, "scripts", "install.mjs"), ""],
    [path.join(stagedRoot, "scripts", "install-runtime.mjs"), ""],
    ["/opt/node/bin/node", ""],
  ]);
  const harness = createUpdateHarness(files, runtimeRoot);
  const status = harness.handlers.get("codex-workflow:update:get")(harness.trusted);
  assert.equal(status.available, false);
  assert.equal(status.availableVersion, "0.5.11");
  assert.equal(status.blockedReason, "updates-disabled");

  const result = await harness.handlers.get("codex-workflow:update:install")(harness.trusted);
  assert.equal(result.available, false);
  assert.equal(harness.spawned.length, 0);
  assert.equal(harness.relaunchCount(), 0);
  assert.equal(harness.exitCount(), 0);
});

test("Workflow Update does not quit while patch recovery is pending", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-recovery-test";
  const stagedRoot = path.join(runtimeRoot, "updates", "0.5.0");
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      nodeExecutable: "/opt/node/bin/node",
      ...compatibilityConfig,
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
    [path.join(stagedRoot, "workflow-compatibility.json"), releaseManifest("0.5.0")],
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
