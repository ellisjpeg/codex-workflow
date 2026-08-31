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
    }),
    {
      schemaVersion: 2,
      focusedInterface: false,
      hidePullRequests: false,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
    },
  );
});

test("Workflow Update launches the detached updater and quits without a dialog", async () => {
  const handlers = new Map();
  const spawned = [];
  const timeoutCallbacks = [];
  let quitCount = 0;
  let exitCount = 0;
  const runtimeRoot = "/tmp/codex-workflow-main-update-test";
  const sourceRoot = "/tmp/codex-workflow-source-test";
  const files = new Map([
    [path.join(runtimeRoot, "update-config.json"), JSON.stringify({
      sourceRoot,
      nodeExecutable: "/opt/node/bin/node",
    })],
    [path.join(runtimeRoot, "state.json"), JSON.stringify({ patchVersion: "0.4.4" })],
    [path.join(sourceRoot, "package.json"), JSON.stringify({ version: "0.5.0" })],
    ["/opt/node/bin/node", ""],
  ]);
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
                if (event === "spawn") queueMicrotask(callback);
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
  const trusted = { senderFrame: { url: "app://codex/thread" } };
  const status = handlers.get("codex-workflow:update:get")(trusted);
  assert.equal(status.available, true);
  assert.equal(status.availableVersion, "0.5.0");

  const result = await handlers.get("codex-workflow:update:install")(trusted);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.applying, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].executable, "/opt/node/bin/node");
  assert.equal(spawned[0].options.detached, true);
  assert.equal(spawned[0].options.env.CODEX_WORKFLOW_ROOT, runtimeRoot);
  assert.deepEqual(
    JSON.parse(JSON.stringify(spawned[0].args.slice(1))),
    ["--apply", "--relaunch", "--parent", "456"],
  );
  assert.equal(spawned[0].unref, true);
  assert.equal(quitCount, 1);
  assert.equal(timeoutCallbacks.length, 1);
  assert.equal(timeoutCallbacks[0].delay, 2000);
  assert.equal(timeoutCallbacks[0].unrefCalled, true);
  timeoutCallbacks[0].callback();
  assert.equal(exitCount, 1);
  await assert.rejects(
    handlers.get("codex-workflow:update:install")({ senderFrame: { url: "https://example.com" } }),
    /untrusted renderer/u,
  );
});
