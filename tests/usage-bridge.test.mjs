import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../runtime/preload.cjs", import.meta.url), "utf8");
const bridge = source.slice(source.indexOf("async function installNativeUsageBridge("), source.indexOf("\nfunction isTopFrame("));
const nativeImport = "await import(new URL('./app-initial-9b95fa538c62.js', assets[0].src).href)";
assert.equal(bridge.split(nativeImport).length, 2);

const raw = (used = 25, account = "fixture-account") => ({
  account_id: account,
  secret: "must-not-leave-main-world",
  rate_limit: {
    allowed: true,
    primary_window: { used_percent: used, limit_window_seconds: 18000, reset_at: 2000000000 },
    secondary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: null },
  },
  additional_rate_limits: [{ limit_name: "reserve", rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 60 } } }],
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(initial = raw(), url = "app://codex/index.html") {
  const dom = new JSDOM('<script type="module" src="./assets/index-b0a81f126468.js"></script>', {
    url, runScripts: "outside-only",
  });
  const { window } = dom;
  let now = 1900000000000;
  let timerId = 0;
  const timers = new Map();
  window.Date.now = () => now;
  window.setTimeout = (fn, delay) => {
    const id = ++timerId;
    timers.set(id, { fn, at: now + delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  const cacheListeners = new Set();
  const handlers = new Map();
  const output = [];
  let state = { data: initial, status: "success", dataUpdatedAt: 1 };
  let nextFetch;
  let importGate;
  let fetches = 0;
  let cancellations = 0;
  let imports = 0;
  const fetchOptions = [];
  const client = {
    getQueryState() { return state; },
    getQueryCache() {
      return { subscribe(fn) { cacheListeners.add(fn); return () => cacheListeners.delete(fn); } };
    },
    cancelQueries(filter) { assert.equal(filter.exact, true); cancellations += 1; return Promise.resolve(); },
    async fetchQuery(options) {
      assert.deepEqual(Array.from(options.queryKey), ["rate-limit-status"]);
      fetches += 1;
      fetchOptions.push(options.staleTime);
      const fetch = nextFetch;
      nextFetch = null;
      if (fetch) await fetch.promise;
      return state.data;
    },
  };
  const scope = { queryClient: client, query: { getOptions: () => ({ queryKey: ["rate-limit-status"], staleTime: 30000 }) } };
  let mounted = scope;
  const native = {
    tg: () => mounted,
    rz: {},
    xmn: { subscribe(type, fn) {
      const set = handlers.get(type) ?? new Set();
      handlers.set(type, set);
      set.add(fn);
      return () => set.delete(fn);
    } },
  };
  // Only the module loader is replaced; the complete self-contained function
  // executes in a separate DOM realm with native API fixtures.
  window.__importNative = async (url) => {
    imports += 1;
    assert.equal(url, new URL("./assets/app-initial-9b95fa538c62.js", window.location.href).href);
    const gate = importGate;
    importGate = null;
    if (gate) await gate.promise;
    return native;
  };
  window.__importBus = async (url) => {
    assert.equal(url, new URL("./assets/message-bus-828b3d0e2c34.js", window.location.href).href);
    return { r: native.xmn };
  };
  window.eval(bridge.replace(nativeImport, "await __importNative(new URL('./app-initial-9b95fa538c62.js', assets[0].src).href)")
    .replace("await import(new URL(", "await __importBus(new URL("));
  window.addEventListener("codex-workflow:usage", (event) => {
    assert.equal(typeof event.detail, "string");
    assert.ok(!event.detail.includes("fixture-account") && !event.detail.includes("must-not-leave"));
    const value = JSON.parse(event.detail);
    assert.deepEqual(Object.keys(value).sort(), ["blocked", "unavailable", "windows"]);
    output.push(value);
  });
  return {
    window, output, handlers, cacheListeners, client, scope, fetchOptions,
    install: (enabled) => window.installNativeUsageBridge(enabled),
    get fetches() { return fetches; },
    get cancellations() { return cancellations; },
    get imports() { return imports; },
    get now() { return now; },
    get timerCount() { return timers.size; },
    get nextDelay() { return Math.min(...[...timers.values()].map((timer) => timer.at - now)); },
    advance(ms) {
      now += ms;
      let runs = 0;
      for (const [id, timer] of timers) {
        if (timer.at > now) continue;
        assert.ok(++runs < 10, "reset scheduling must not spin");
        timers.delete(id);
        timer.fn();
      }
    },
    hold() { const hold = deferred(); nextFetch = hold; return hold; },
    holdImport() { const hold = deferred(); importGate = hold; return hold; },
    setScope(value) { mounted = value; },
    update(data, status = "success", key = ["rate-limit-status"]) {
      state = { data, status, dataUpdatedAt: state.dataUpdatedAt + 1 };
      for (const listener of cacheListeners) listener({ query: { queryKey: key } });
    },
    message(type, value) { for (const handler of handlers.get(type) ?? []) handler(value); },
    notification(method, params, hostId = "local") { this.message("mcp-notification", { method, params, hostId }); },
    async close() { await this.install(false); dom.window.close(); },
  };
}

test("native cache projection is sanitized, exact-key scoped, idempotent and disposable", async () => {
  const h = harness();
  await h.install(true);
  await flush();
  assert.equal(h.cacheListeners.size, 1);
  assert.deepEqual(h.output.at(-1), { windows: [
    { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000000000 },
    { usedPercent: 30, windowDurationMins: 10080, resetsAt: null },
  ], blocked: false, unavailable: false });
  await h.install(true);
  assert.equal(h.cacheListeners.size, 1);
  assert.equal(h.fetches, 1);
  const count = h.output.length;
  h.update(raw(99), "success", ["rate-limit-status", "unrelated"]);
  assert.equal(h.output.length, count);
  await h.install(false);
  assert.equal(h.cacheListeners.size, 0);
  assert.equal(h.timerCount, 0);
  assert.ok([...h.handlers.values()].every((set) => set.size === 0));
  assert.equal(h.output.at(-1).unavailable, true);
  const stopped = h.output.length;
  h.window.dispatchEvent(new h.window.Event("focus"));
  h.update(raw(77));
  assert.equal(h.output.length, stopped);
  await h.close();
});

test("empty, malformed, monthly-duration and exhausted core data retain honest availability", async () => {
  const h = harness(null);
  await h.install(true);
  await flush();
  assert.equal(h.output.at(-1).unavailable, true);
  const data = raw(0);
  data.rate_limit.secondary_window = { used_percent: 101, limit_window_seconds: 2592000, reset_at: "not-a-time" };
  h.update(data);
  assert.equal(h.output.at(-1).windows[0].usedPercent, 0);
  assert.equal(h.output.at(-1).windows[1].windowDurationMins, 43200);
  assert.equal(h.output.at(-1).windows[1].resetsAt, null);
  assert.equal(h.output.at(-1).blocked, true);
  data.rate_limit.primary_window.used_percent = "20";
  data.rate_limit.secondary_window.limit_window_seconds = Infinity;
  h.update(data);
  assert.equal(h.output.at(-1).unavailable, true);
  await h.close();
});

test("routine sparse updates preserve native staleTime and never revert to unchanged cached data", async () => {
  const h = harness();
  await h.install(true);
  await flush();
  const hold = h.hold();
  h.notification("account/rateLimits/updated", { rateLimits: { limitId: "codex", primary: { usedPercent: 40 } } });
  assert.deepEqual(h.output.at(-1).windows.map((w) => w.usedPercent), [40, 30]);
  await flush();
  h.notification("account/rateLimits/updated", { rateLimits: { limitId: "reserve", primary: { usedPercent: 100, windowDurationMins: 1 } } });
  assert.equal(h.output.at(-1).windows[0].usedPercent, 40);
  const count = h.output.length;
  h.notification("account/rateLimits/updated", { rateLimits: { limitId: "codex", primary: { usedPercent: 90 } } }, "remote");
  assert.equal(h.output.length, count);
  assert.equal(h.fetches, 2);
  hold.resolve();
  await flush();
  assert.equal(h.fetches, 2);
  assert.deepEqual(h.fetchOptions, [30000, 30000]);
  assert.deepEqual(h.output.at(-1).windows.map((w) => w.usedPercent), [40, 30]);
  h.window.dispatchEvent(new h.window.Event("focus"));
  await flush();
  assert.equal(h.output.at(-1).windows[0].usedPercent, 40);
  h.update(raw(45));
  assert.equal(h.output.at(-1).windows[0].usedPercent, 45);
  await h.close();
});

test("one reset timeout clears expired data, forces one read, and never loops on the expired response", async () => {
  const h = harness();
  const data = raw();
  data.rate_limit.primary_window.reset_at = (h.now + 1000) / 1000;
  h.update(data);
  await h.install(true);
  await flush();
  assert.equal(h.timerCount, 1);
  assert.equal(h.nextDelay, 1000);
  const hold = h.hold();
  h.advance(1000);
  assert.equal(h.output.at(-1).unavailable, true);
  await flush();
  assert.equal(h.fetchOptions.at(-1), 0);
  hold.resolve();
  await flush();
  assert.equal(h.output.at(-1).unavailable, true);
  assert.equal(h.timerCount, 0);
  assert.equal(h.fetches, 2);
  const next = raw(0);
  next.rate_limit.primary_window.reset_at = (h.now + 5000) / 1000;
  h.update(next);
  assert.equal(h.output.at(-1).unavailable, false);
  assert.equal(h.timerCount, 1);
  h.notification("account/updated", { authMode: null });
  assert.equal(h.timerCount, 0);
  await h.close();
});

test("monthly reset delay handoff does not refresh early and unload disposes the sole timer", async () => {
  const h = harness();
  const data = raw();
  data.rate_limit.primary_window.reset_at = (h.now + 2592000000) / 1000;
  h.update(data);
  await h.install(true);
  await flush();
  assert.equal(h.nextDelay, 2147483647);
  h.advance(2147483647);
  assert.equal(h.fetches, 1);
  assert.equal(h.timerCount, 1);
  assert.equal(h.nextDelay, 2592000000 - 2147483647);
  h.window.dispatchEvent(new h.window.Event("pagehide"));
  assert.equal(h.timerCount, 0);
  await h.close();
});

test("missing audited asset stays unavailable without retry until explicitly disabled", async () => {
  const h = harness();
  const link = h.window.document.querySelector('script[type="module"]');
  link.remove();
  await h.install(true);
  assert.equal(h.output.at(-1).unavailable, true);
  h.window.document.head.append(link);
  await h.install(true);
  h.window.dispatchEvent(new h.window.Event("focus"));
  await flush();
  assert.equal(h.imports, 0);
  assert.equal(h.timerCount, 0);
  assert.equal(h.cacheListeners.size, 0);
  await h.install(false);
  await h.install(true);
  await flush();
  assert.equal(h.imports, 1);
  assert.equal(h.output.at(-1).unavailable, false);
  await h.close();
});

test("the observed avatar overlay installs nothing while the main app URL still works", async () => {
  const overlay = harness(raw(), "app://-/index.html?initialRoute=%2Favatar-overlay");
  await overlay.install(true);
  assert.equal(overlay.imports, 0);
  assert.equal(overlay.cacheListeners.size, 0);
  assert.equal(overlay.handlers.size, 0);
  assert.equal(overlay.timerCount, 0);
  assert.equal(overlay.output.length, 0);
  assert.equal(overlay.window.__codexWorkflowNativeUsageBridge, undefined);
  await overlay.close();
  const main = harness(raw(), "app://-/index.html");
  await main.install(true);
  await flush();
  assert.equal(main.imports, 1);
  assert.equal(main.output.at(-1).unavailable, false);
  await main.close();
});

test("account epochs reject old in-flight data and sparse updates until a fresh read completes", async () => {
  const h = harness();
  const old = h.hold();
  await h.install(true);
  await flush();
  h.notification("account/updated", { authMode: "chatgpt" });
  assert.equal(h.output.at(-1).unavailable, true);
  const fresh = h.hold();
  h.update(raw(99, "old-account"));
  h.notification("account/rateLimits/updated", { rateLimits: { limitId: "codex", primary: { usedPercent: 100, windowDurationMins: 300 } } });
  assert.equal(h.output.at(-1).unavailable, true);
  old.resolve();
  await flush();
  assert.equal(h.output.at(-1).unavailable, true);
  assert.ok(h.cancellations >= 2);
  h.update(raw(5, "new-account"));
  fresh.resolve();
  await flush();
  assert.equal(h.output.at(-1).windows[0].usedPercent, 5);
  const identityCheck = h.hold();
  h.update(raw(98, "old-account"));
  assert.equal(h.output.at(-1).unavailable, true);
  await flush();
  h.update(raw(6, "new-account"));
  identityCheck.resolve();
  await flush();
  assert.equal(h.output.at(-1).windows[0].usedPercent, 6);
  await h.close();
});

test("disconnect, errors and disable suppress late completions; reconnect uses a fresh native query", async () => {
  const h = harness();
  await h.install(true);
  await flush();
  h.message("codex-app-server-connection-changed", { hostId: "local", state: "disconnected" });
  h.update(raw(60));
  assert.equal(h.output.at(-1).unavailable, true);
  const hold = h.hold();
  h.message("codex-app-server-connection-changed", { hostId: "local", state: "connected" });
  await flush();
  assert.equal(h.output.at(-1).unavailable, true);
  hold.reject(new Error("unsanitized native account error"));
  await flush();
  assert.equal(h.output.at(-1).unavailable, true);
  const late = h.hold();
  h.window.dispatchEvent(new h.window.Event("focus"));
  await flush();
  await h.install(false);
  const count = h.output.length;
  late.resolve();
  await flush();
  assert.equal(h.output.length, count);
  await h.close();
});

test("missing scope can recover on a native route event without polling", async () => {
  const h = harness();
  h.setScope(null);
  await h.install(true);
  assert.equal(h.output.at(-1).unavailable, true);
  h.setScope(h.scope);
  h.message("navigate-to-route", { path: "/settings/usage" });
  await flush();
  assert.equal(h.output.at(-1).unavailable, false);
  assert.equal(h.cacheListeners.size, 1);
  await h.close();
});

test("replacement query client disposes the old cache and rejects its in-flight completion", async () => {
  const h = harness();
  const replacement = harness(raw(8, "replacement-account"));
  const old = h.hold();
  await h.install(true);
  await flush();
  h.setScope(replacement.scope);
  h.message("navigate-to-route", { path: "/" });
  await flush();
  assert.equal(h.cacheListeners.size, 0);
  assert.equal(replacement.cacheListeners.size, 1);
  assert.equal(h.output.at(-1).unavailable, true);
  h.update(raw(95));
  old.resolve();
  await flush();
  assert.equal(h.output.at(-1).windows[0].usedPercent, 8);
  await h.close();
  assert.equal(replacement.cacheListeners.size, 0);
  await replacement.close();
});

test("a disabled asynchronous installation cannot clear or duplicate its successor", async () => {
  const h = harness();
  const gate = h.holdImport();
  const oldInstall = h.install(true);
  await h.install(false);
  await h.install(true);
  await flush();
  const count = h.output.length;
  gate.reject(new Error("late import failure"));
  await oldInstall;
  assert.equal(h.output.length, count);
  assert.equal(h.cacheListeners.size, 1);
  await h.close();
});
