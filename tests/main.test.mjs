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
      schemaVersion: 5,
      sidebarNavigation: loadSettings({}).sidebarNavigation,
      focusedInterface: false,
      hiddenSettingsPages: [],
      hidePullRequests: true,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
      hideComposerMicrophone: false,
      composerModelLabel: "full", composerReasoningLabel: "full", composerWidth: "default",
      conversationWidth: null, messageSpacing: "default", userMessageStyle: "bubble", toolActivity: "summary", showMessageTimestamps: false,
      showUsageRemaining: true,
      usageRemainingLocation: "toolbar",
      usageDisplay: "remaining",
      usageWindow: "automatic",
      showContextUsage: false,
      lowUsageAlert: false,
      usageAlertThreshold: 10,
    },
  );
});

test("navigation normalisation protects locked entries and rejects malformed IDs", () => {
  const prefs = loadSettings({sidebarNavigation:{order:["explore","new-chat","explore"],
    hidden:["new-chat","plugins"], settingsHidden:["workflow", "appearance", "\"{}"],
    accountHidden:["settings","logout","pet"], width:NaN}}).sidebarNavigation;
  assert.deepEqual(prefs.order, ["explore","pull-requests","scheduled","plugins","settings-shortcut"]);
  assert.deepEqual(prefs.hidden,["plugins"]);
  assert.deepEqual(prefs.settingsHidden,["appearance"]);
  assert.deepEqual(prefs.accountHidden,["pet"]);
  assert.equal(prefs.width,null);
  assert.equal(prefs.showRecentChats,true);
});

test("schema 2 visibility choices migrate without overriding newer navigation choices", () => {
  const legacy = {schemaVersion:2, hidePullRequests:true, hidePetMenuItem:true,
    hideInviteFriendMenuItem:true, hiddenSettingsPages:["appearance", "workflow"], replaceHelpWithSettings:false};
  const next = loadSettings(legacy);
  assert.deepEqual(next.sidebarNavigation.hidden, ["pull-requests", "settings-shortcut"]);
  assert.deepEqual(next.sidebarNavigation.settingsHidden, ["appearance"]);
  assert.deepEqual(next.sidebarNavigation.accountHidden, ["pet", "invite"]);
  assert.deepEqual(loadSettings({...legacy, sidebarNavigation:{hidden:[], settingsHidden:[], accountHidden:[]}}).sidebarNavigation.hidden, []);
  assert.deepEqual(loadSettings(next), next);
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
      schemaVersion: 5,
      sidebarNavigation: loadSettings({}).sidebarNavigation,
      focusedInterface: false,
      hidePullRequests: false,
      hidePetMenuItem: true,
      hiddenSettingsPages: [],
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
      hideComposerMicrophone: false,
      composerModelLabel: "full", composerReasoningLabel: "full", composerWidth: "default",
      conversationWidth: null, messageSpacing: "default", userMessageStyle: "bubble", toolActivity: "summary", showMessageTimestamps: false,
      showUsageRemaining: true,
      usageRemainingLocation: "toolbar",
      usageDisplay: "remaining",
      usageWindow: "automatic",
      showContextUsage: false,
      lowUsageAlert: false,
      usageAlertThreshold: 10,
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

test("shortcut membership migrates and removal survives atomic persistence and restart", () => {
  const legacy = loadSettings({schemaVersion:3,sidebarNavigation:{order:['explore'],hidden:['settings-shortcut']}});
  assert.ok(legacy.sidebarNavigation.order.includes('settings-shortcut'));
  assert.equal(legacy.sidebarNavigation.footerShortcut,'whats-new-shortcut');
  assert.equal(loadSettings({sidebarNavigation:{footerShortcut:'invalid'}}).sidebarNavigation.footerShortcut,'whats-new-shortcut');
  const next = loadSettings({schemaVersion:4,sidebarNavigation:{
    order:['usage-shortcut','usage-shortcut','general-shortcut','settings-shortcut','whats-new-shortcut','workflow-shortcut','profile-shortcut','invalid',null],
    hidden:['general-shortcut','usage-shortcut','invalid'],
    footerShortcut:'general-shortcut',
  }});
  assert.deepEqual(next.sidebarNavigation.order,['usage-shortcut','settings-shortcut','whats-new-shortcut','workflow-shortcut','profile-shortcut','pull-requests','scheduled','plugins','explore']);
  assert.deepEqual(next.sidebarNavigation.hidden,['settings-shortcut','usage-shortcut']);
  assert.equal(next.sidebarNavigation.footerShortcut,'settings-shortcut');
  const account = loadSettings({schemaVersion:4,sidebarNavigation:{settingsOrder:['account'],settingsHidden:['account']}});
  assert.deepEqual(account.sidebarNavigation.settingsOrder,['account']);
  assert.deepEqual(account.sidebarNavigation.settingsHidden,['account']);
  for (const footerShortcut of ['workflow-shortcut','profile-shortcut']) {
    assert.equal(loadSettings({...next,sidebarNavigation:{...next.sidebarNavigation,footerShortcut}}).sidebarNavigation.footerShortcut,footerShortcut);
  }
  assert.deepEqual(loadSettings(next),next);
  const root = fs.mkdtempSync(path.join(tmpdir(),'workflow-shortcuts-'));
  try {
    const h = createUpdateHarness(new Map(),root,fs);
    h.handlers.get('codex-workflow:settings:set')(h.trusted,next);
    const reopened = createUpdateHarness(new Map(),root,fs);
    const saved = reopened.handlers.get('codex-workflow:settings:get')(h.trusted);
    assert.deepEqual(JSON.parse(JSON.stringify(saved)),next);
    assert.equal(fs.statSync(path.join(root,'settings.json')).mode & 0o777,0o600);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("numeric sidebar width accepts only bounded integers from the main Codex frame", async () => {
  const h = createUpdateHarness(new Map());
  const scripts = [];
  const frame = {url:"app://-/index.html"};
  const sender = {mainFrame:frame, isDestroyed:()=>false, getURL:()=>frame.url,
    executeJavaScript:async script => { scripts.push(script); return 321; }};
  const event = {sender,senderFrame:frame};
  const resize = h.handlers.get("codex-workflow:sidebar-width");
  assert.equal(await resize(event,{action:"get"}),321);
  assert.doesNotMatch(scripts.at(-1),/native\.e3t\('sidebar-width'/);
  assert.equal(await resize(event,{action:"set",width:321}),321);
  assert.match(scripts.at(-1),/native\.e3t\('sidebar-width', 321\)/);
  for (const width of [239,521,NaN,Infinity,"321",321.5]) {
    await assert.rejects(resize(event,{action:"set",width}),/Invalid sidebar width/);
  }
  await assert.rejects(resize({...event,senderFrame:{url:frame.url}},{action:"get"}),/rejected sidebar width access/);
  await assert.rejects(resize({...event,senderFrame:{url:"https://example.com"}},{action:"get"}),/untrusted renderer/);
  assert.equal(scripts.length,2);
});

function createUpdateHarness(files, runtimeRoot = "/tmp/codex-workflow-main-update-test", fileSystem, processResult = {}) {
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
            if (processResult.throwOnSpawn) throw processResult.throwOnSpawn;
            return {
              pid: 789,
              once(event, callback) {
                if (event === "error" && processResult.error) queueMicrotask(() => callback(processResult.error));
                if (event === "close") queueMicrotask(() => {
                  processResult.beforeClose?.();
                  callback(processResult.code === undefined ? 0 : processResult.code, processResult.signal || null);
                });
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

function availableUpdateFiles(root, version = "0.5.0", installed = "0.4.4") {
  const staged = path.join(root, "updates", version);
  return new Map([
    [path.join(root, "update-config.json"), JSON.stringify({nodeExecutable:"/opt/node/bin/node", ...compatibilityConfig})],
    [path.join(root, "state.json"), JSON.stringify({patchVersion:installed})],
    [path.join(root, "update-state.json"), JSON.stringify({availableVersion:version, stagedSourceRoot:staged})],
    [path.join(staged, "package.json"), JSON.stringify({name:"codex-workflow", version})],
    [path.join(staged, "workflow-compatibility.json"), releaseManifest(version)],
    [path.join(staged, "scripts/install.mjs"), ""],
    [path.join(staged, "scripts/install-runtime.mjs"), ""],
    ["/opt/node/bin/node", ""],
  ]);
}

for (const outcome of ["no-op", "transaction", "reported-error"]) {
  test(`Workflow Update refuses a successful helper exit with ${outcome}`, async () => {
    const root = "/tmp/codex-workflow-main-completion-test";
    const files = availableUpdateFiles(root);
    const result = { beforeClose() {
      if (outcome === "no-op") return;
      files.set(path.join(root, "runtime/version.json"), JSON.stringify({version:"0.5.0"}));
      if (outcome === "transaction") files.set(path.join(root, "transaction.json"), "{}");
      else files.set(path.join(root, "update-state.json"), JSON.stringify({error:"verification failed"}));
    } };
    const h = createUpdateHarness(files, root, undefined, result);
    await assert.rejects(h.handlers.get("codex-workflow:update:install")(h.trusted), /did not complete/u);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.relaunchCount(), 0);
    assert.equal(h.exitCount(), 0);
    if (outcome === "no-op") {
      result.beforeClose = () => files.set(path.join(root, "runtime/version.json"), JSON.stringify({version:"0.5.0"}));
      assert.equal((await h.handlers.get("codex-workflow:update:install")(h.trusted)).applying, true);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.spawned.length, 2, "failed verification releases the in-flight guard for retry");
      assert.equal(h.relaunchCount(), 1);
    }
  });
}

for (const processResult of [{code:1}, {code:null, signal:"SIGTERM"}, {error:Error("spawn failed"), code:1}, {throwOnSpawn:Error("spawn threw")}]) {
  test(`Workflow Update does not relaunch after helper failure: ${processResult.signal || processResult.error?.message || processResult.throwOnSpawn?.message || processResult.code}`, async () => {
    const root = "/tmp/codex-workflow-main-failed-child-test";
    const h = createUpdateHarness(availableUpdateFiles(root), root, undefined, processResult);
    await assert.rejects(h.handlers.get("codex-workflow:update:install")(h.trusted));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.relaunchCount(), 0);
    assert.equal(h.exitCount(), 0);
  });
}

test("update UI uses strict release versions and prerelease precedence", () => {
  const runtimeRoot = "/tmp/workflow-version-fixture";
  const stagedRoot = path.join(runtimeRoot, "staged");
  for (const [version, installed, available] of [
    ["1.0.0-../../escape", "0.5.41", false],
    ["1.0.0-01", "0.5.41", false],
    ["01.0.0", "0.5.41", false],
    ["1.0.0\n", "0.5.41", false],
    [["1.0.0"], "0.5.41", false],
    ["1.0.0", "not-a-version", false],
    ["1.0.0", "1.0.0-rc.1", true],
    ["1.0.0-rc.1", "1.0.0", false],
    ["1.0.0-9007199254740993", "1.0.0-9007199254740992", true],
    ["1.0.0+new", "1.0.0+old", false],
  ]) {
    const files = new Map([
      [path.join(runtimeRoot, "update-config.json"), JSON.stringify(compatibilityConfig)],
      [path.join(runtimeRoot, "state.json"), JSON.stringify({ patchVersion: installed })],
      [path.join(runtimeRoot, "update-state.json"), JSON.stringify({ availableVersion: version, stagedSourceRoot: stagedRoot })],
      [path.join(stagedRoot, "package.json"), JSON.stringify({ name: "codex-workflow", version })],
      [path.join(stagedRoot, "workflow-compatibility.json"), releaseManifest(version)],
      [path.join(stagedRoot, "scripts/install.mjs"), ""],
      [path.join(stagedRoot, "scripts/install-runtime.mjs"), ""],
    ]);
    const h = createUpdateHarness(files, runtimeRoot);
    assert.equal(h.handlers.get("codex-workflow:update:get")(h.trusted).available, available,
      `${JSON.stringify(version)} against ${installed}`);
  }
});

test("Workflow Update installs the external runtime before relaunching", async () => {
  const runtimeRoot = "/tmp/codex-workflow-main-update-test";
  const files = availableUpdateFiles(runtimeRoot);
  const harness = createUpdateHarness(files, runtimeRoot, undefined, { beforeClose() {
    files.set(path.join(runtimeRoot, "runtime/version.json"), JSON.stringify({version:"0.5.0"}));
  } });
  const status = harness.handlers.get("codex-workflow:update:get")(harness.trusted);
  assert.equal(status.available, true);
  assert.equal(status.availableVersion, "0.5.0");
  assert.equal(status.blockedReason, null);

  const result = await harness.handlers.get("codex-workflow:update:install")(harness.trusted);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.applying, true);
  assert.equal(result.installedVersion, "0.5.0");
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
