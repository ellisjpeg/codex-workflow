import assert from "node:assert/strict";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Script, createContext } from "node:vm";
import test from "node:test";

const mainSource = fs.readFileSync(new URL("../runtime/main.cjs", import.meta.url), "utf8");
const trusted = { senderFrame: { url: "app://codex/settings" } };

function loadRuntime(root, fileSystem = fs) {
  const handlers = new Map();
  const context = createContext({
    process: { env: { CODEX_WORKFLOW_ROOT: root }, pid: process.pid },
    require(name) {
      if (name === "electron") return {
        app: { getVersion: () => "test", on() {}, whenReady: () => ({ then() {} }) },
        ipcMain: { handle(channel, handler) { handlers.set(channel, handler); }, on() {} },
        session: { defaultSession: {} },
        webContents: { getAllWebContents: () => [] },
      };
      if (name === "node:fs") return fileSystem;
      if (name === "node:path") return path;
      if (name === "node:crypto") return { randomUUID };
      if (name === "node:child_process") return { spawn() { throw new Error("Unexpected spawn"); } };
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  new Script(mainSource, { filename: "main.cjs" }).runInContext(context);
  return {
    get(event = trusted) {
      return JSON.parse(JSON.stringify(handlers.get("codex-workflow:settings:get")(event)));
    },
    set(patch, event = trusted) {
      return JSON.parse(JSON.stringify(handlers.get("codex-workflow:settings:set")(event, patch)));
    },
  };
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "workflow-usage-settings-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("usage defaults remain schema 3 and reject malformed values", (t) => {
  const root = temporaryRoot(t);
  const runtime = loadRuntime(root);
  const defaults = runtime.get();
  assert.equal(defaults.schemaVersion, 3);
  assert.equal(defaults.showUsageRemaining, true);
  assert.equal(defaults.usageRemainingLocation, "toolbar");
  const settingsPath = path.join(root, "settings.json");
  for (const value of [null, [], {}, "composer", 1, false]) {
    fs.writeFileSync(settingsPath, JSON.stringify(value));
    assert.deepEqual(runtime.get(), defaults);
  }
  fs.writeFileSync(settingsPath, "{invalid json");
  assert.deepEqual(runtime.get(), defaults);
  fs.writeFileSync(settingsPath, JSON.stringify({ schemaVersion: 1, efficiencyMode: false }));
  assert.deepEqual(runtime.get(), { ...defaults, focusedInterface: false });
  for (const value of [null, 0, 1, "false", "true", [], {}]) {
    assert.equal(runtime.set({ showUsageRemaining: value }).showUsageRemaining, true);
  }
  for (const value of [null, false, 1, "", "Toolbar", "sidebar", ["composer"], {}]) {
    assert.equal(runtime.set({ usageRemainingLocation: value }).usageRemainingLocation, "toolbar");
  }
  assert.equal(runtime.set({ showUsageRemaining: false }).showUsageRemaining, false);
  assert.equal(runtime.set({ showUsageRemaining: true }).showUsageRemaining, true);
  assert.equal(runtime.set({ usageRemainingLocation: "composer" }).usageRemainingLocation, "composer");
  assert.equal(runtime.set({ usageRemainingLocation: "toolbar" }).usageRemainingLocation, "toolbar");
});

test("narrow usage patches preserve settings and roundtrip through an atomic owner-only write", (t) => {
  const root = temporaryRoot(t);
  const settingsPath = path.join(root, "settings.json");
  const existing = loadRuntime(root).set({
    focusedInterface: false,
    hidePullRequests: false,
    hidePetMenuItem: false,
    hideInviteFriendMenuItem: false,
    replaceHelpWithSettings: false,
    hideComposerMicrophone: true,
    hiddenSettingsPages: ["appearance", "voice"],
  });
  const expected = { ...existing, showUsageRemaining: false, usageRemainingLocation: "composer" };
  const operations = [];
  const runtime = loadRuntime(root, {
    ...fs,
    fsyncSync(fd) {
      operations.push(fs.fstatSync(fd).isDirectory() ? "sync-directory" : "sync-file");
      fs.fsyncSync(fd);
    },
    renameSync(from, to) {
      assert.equal(path.dirname(from), root);
      assert.match(path.basename(from), /^\.settings-.*\.tmp$/u);
      assert.equal(to, settingsPath);
      assert.equal(fs.statSync(from).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(fs.readFileSync(to, "utf8")), existing);
      assert.deepEqual(JSON.parse(fs.readFileSync(from, "utf8")), expected);
      operations.push("rename");
      fs.renameSync(from, to);
    },
  });
  assert.deepEqual(runtime.set({ showUsageRemaining: false, usageRemainingLocation: "composer", unknown: true }), expected);
  assert.deepEqual(operations, ["sync-file", "rename", "sync-directory"]);
  assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);
  const reopened = loadRuntime(root);
  assert.deepEqual(reopened.get(), expected);
  assert.deepEqual(reopened.set({ hidePullRequests: true }), { ...expected, hidePullRequests: true });
  assert.equal(fs.readdirSync(root).some((entry) => entry.startsWith(".settings-")), false);
});

test("usage settings reject untrusted reads and writes without changing disk", (t) => {
  const root = temporaryRoot(t);
  const runtime = loadRuntime(root);
  const saved = runtime.set({ showUsageRemaining: false, usageRemainingLocation: "composer" });
  const settingsPath = path.join(root, "settings.json");
  const original = fs.readFileSync(settingsPath, "utf8");
  for (const event of [
    {},
    { senderFrame: { url: "https://example.com" } },
    { sender: { getURL: () => "file:///tmp/settings.html" } },
    { senderFrame: { url: "https://example.com" }, sender: { getURL: () => "app://codex/settings" } },
  ]) {
    assert.throws(() => runtime.get(event), /untrusted renderer/u);
    assert.throws(() => runtime.set({ showUsageRemaining: true }, event), /untrusted renderer/u);
    assert.equal(fs.readFileSync(settingsPath, "utf8"), original);
  }
  assert.deepEqual(runtime.get({ sender: { getURL: () => "app://codex/thread" } }), saved);
});

test("failed atomic usage replacement preserves the previous settings and removes its temporary file", (t) => {
  const root = temporaryRoot(t);
  const settingsPath = path.join(root, "settings.json");
  loadRuntime(root).set({ hiddenSettingsPages: ["appearance"] });
  const original = fs.readFileSync(settingsPath, "utf8");
  const runtime = loadRuntime(root, {
    ...fs,
    renameSync() { throw new Error("Injected rename failure"); },
  });
  assert.throws(() => runtime.set({ showUsageRemaining: false, usageRemainingLocation: "composer" }), /Injected rename failure/u);
  assert.equal(fs.readFileSync(settingsPath, "utf8"), original);
  assert.equal(fs.readdirSync(root).some((entry) => entry.startsWith(".settings-")), false);
});
