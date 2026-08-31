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
            whenReady: () => ({ then() {} }),
          },
          ipcMain: {
            handle(channel, handler) {
              handlers.set(channel, handler);
            },
            on() {},
          },
          session: { defaultSession: {} },
        };
      }
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
    }),
    {
      schemaVersion: 2,
      focusedInterface: false,
      hidePullRequests: false,
      hidePetMenuItem: true,
    },
  );
});
