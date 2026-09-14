import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../loader.cjs", import.meta.url), "utf8");

function boot({ runtimeError, logError, originalError, metadata = {
  originalMain: ".vite/build/early-bootstrap.js", runtimeRoot: "/fixture/workflow",
} } = {}) {
  const loaded = [];
  const messages = [];
  const environment = {};
  const original = "/fixture/app/.vite/build/early-bootstrap.js";
  const context = {
    __dirname: "/fixture/app",
    process: { env: environment },
    require(name) {
      if (name === "node:path") return path;
      if (name === "node:fs") return {
        mkdirSync() { if (logError) throw logError; },
        appendFileSync(_file, message) { messages.push(message); },
      };
      if (name === "./package.json") return { __codexWorkflow: metadata };
      loaded.push(name);
      if (name === "/fixture/workflow/runtime/main.cjs") {
        if (runtimeError) throw runtimeError;
        return {};
      }
      assert.equal(name, original, "only the recorded original entry may follow Workflow");
      if (originalError) throw originalError;
      return {};
    },
  };
  return { loaded, messages, environment, run: () => runInNewContext(source, context) };
}

test("loader starts the runtime and original app exactly once in order", () => {
  const h = boot();
  h.run();
  assert.deepEqual(h.loaded, ["/fixture/workflow/runtime/main.cjs", "/fixture/app/.vite/build/early-bootstrap.js"]);
  assert.equal(h.environment.CODEX_WORKFLOW_ROOT, "/fixture/workflow");
  assert.equal(h.messages.length, 0);
});

for (const loggingFails of [false, true]) {
  test(`loader preserves original startup after runtime failure, logging fails=${loggingFails}`, () => {
    const h = boot({ runtimeError: Error("runtime unavailable"), logError: loggingFails ? Error("disk unavailable") : null });
    h.run();
    assert.deepEqual(h.loaded, ["/fixture/workflow/runtime/main.cjs", "/fixture/app/.vite/build/early-bootstrap.js"]);
    assert.equal(h.messages.length, loggingFails ? 0 : 1);
    if (!loggingFails) assert.match(h.messages[0], /runtime unavailable/u);
  });
}

test("loader preserves a known original entry when runtime metadata is missing", () => {
  const h = boot({ metadata: { originalMain: ".vite/build/early-bootstrap.js" } });
  h.run();
  assert.deepEqual(h.loaded, ["/fixture/app/.vite/build/early-bootstrap.js"]);
});

test("loader refuses to guess an unknown original entry", () => {
  const h = boot({ metadata: {} });
  assert.throws(h.run, /cannot resolve the original app entry point/u);
  assert.deepEqual(h.loaded, []);
});

test("loader does not swallow an error from the original application", () => {
  const originalError = Error("original app failure");
  const h = boot({ originalError });
  assert.throws(h.run, error => error === originalError);
  assert.equal(h.loaded.length, 2);
});
