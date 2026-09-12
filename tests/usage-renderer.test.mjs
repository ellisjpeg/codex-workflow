import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";

const preloadSource = readFileSync(process.env.WORKFLOW_PRELOAD_PATH || new URL("../runtime/preload.cjs", import.meta.url), "utf8");
const counterSelector = "[data-codex-workflow-usage]";
const toggleSelector = '[role="switch"][aria-labelledby="codex-workflow-showUsageRemaining-label"]';
const locationSelector = 'button[aria-label="Usage remaining location"]';
const menuSelector = '#codex-workflow-usage-location-menu[role="menu"]';
const future = () => Math.floor(Date.now() / 1000) + 3600;
const allowance = (minutes, usedPercent, resetsAt = future()) => ({ windowDurationMins: minutes, usedPercent, resetsAt });
const plain = (value) => JSON.parse(JSON.stringify(value));

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

async function createHarness(t, { placement = "toolbar", setSettings, toolbarCount = 1, footerUsage = false, showUsageRemaining = true } = {}) {
  const toolbar = `<header data-app-shell-header-layout="true" class="flex h-toolbar draggable">
    <div data-app-shell-header-toolbar="true" class="flex min-w-0 flex-1 items-center justify-between">
      <div class="flex min-w-0 items-center"><button aria-label="Back" class="no-drag flex items-center">Back</button></div>
      <div class="flex shrink-0 items-center justify-end gap-2"><button id="share" class="no-drag cursor-interaction inline-flex items-center rounded-lg px-3 text-default">Share</button></div>
    </div>
  </header>`;
  const dom = new JSDOM(`<!doctype html><html><body>
    ${toolbar.repeat(toolbarCount)}
    <aside class="app-shell-left-panel">${footerUsage ? '<div id="app-shell-sidebar"></div><button aria-label="Open help menu" class="size-8 shrink-0 focus-visible:ring-2"><svg></svg></button>' : ''}</aside>
    <div role="presentation" data-composer-layout="multiline">
      <div data-composer-footer-responsive="" data-composer-rows="inline" class="flex items-center justify-between">
        <div id="composer-controls" class="flex min-w-0 items-center gap-2">
          <button id="permissions" data-composer-navigation-target="permissions" class="no-drag cursor-interaction flex items-center rounded-lg text-tertiary px-3">Default permissions</button>
          <button id="model" aria-label="Select model and reasoning">Model</button>
        </div>
        <div class="flex shrink-0 items-center gap-2"><button aria-label="Send">Send</button></div>
      </div>
    </div>
    <div id="settings-shell"><nav aria-label="Settings">
      <button data-settings-panel-slug="general-settings" aria-current="page" class="nav active"><span class="text-fade-truncate">General</span></button>
      <button data-settings-panel-slug="appearance" class="nav inactive"><span class="text-fade-truncate">Appearance</span></button>
      <button data-settings-panel-slug="voice" class="nav inactive"><span class="text-fade-truncate">Voice</span></button>
      <button data-settings-panel-slug="personalization" class="nav inactive"><span class="text-fade-truncate">Personalization</span></button>
    </nav><main id="settings-content"><section>Native settings</section></main></div>
  </body></html>`, { url: "app://codex/settings", pretendToBeVisual: true, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const calls = [];
  const bridgeStates = [];
  const messages = [];
  const listeners = new Map(["pointerdown", "scroll"].map((type) => [type, new Set()]));
  for (const method of ["addEventListener", "removeEventListener"]) {
    const original = document[method].bind(document);
    document[method] = (type, callback, options) => {
      listeners.get(type)?.[method === "addEventListener" ? "add" : "delete"](callback);
      return original(type, callback, options);
    };
  }
  let settings = { schemaVersion: 4, focusedInterface: footerUsage, showUsageRemaining, usageRemainingLocation: placement,
    sidebarNavigation: {footerShortcut: footerUsage ? 'usage-shortcut' : 'whats-new-shortcut'} };
  const context = dom.getInternalVMContext();
  context.require = (name) => {
    assert.equal(name, "electron");
    return { webFrame: footerUsage ? { async executeJavaScript(source) {
      if (source.startsWith('(async function installNativeUsageBridge(')) bridgeStates.push(source.endsWith('(true)'));
    } } : undefined, ipcRenderer: {
      async invoke(channel, patch) {
        calls.push({ channel, patch: patch === undefined ? undefined : plain(patch) });
        if (channel === "codex-workflow:settings:get") return settings;
        if (channel === "codex-workflow:update:get") return { available: false };
        assert.equal(channel, "codex-workflow:settings:set");
        // Chromium blurs the trigger while persistence temporarily disables it.
        if (document.activeElement.disabled) document.activeElement.blur();
        if (setSettings) await setSettings(patch);
        settings = { ...settings, ...patch };
        return settings;
      },
      on() {}, send() {},
    } };
  };
  const observers = [];
  context.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.target = null; }
  };
  let timer = 0;
  context.setTimeout = () => ++timer;
  context.clearTimeout = () => {};
  context.requestAnimationFrame = (callback) => { callback(); return ++timer; };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches("nav")) return { width: 240, height: 420, left: 0, right: 240, top: 0, bottom: 420 };
    if (this.id === "settings-content") return { width: 640, height: 520, left: 240, right: 880, top: 0, bottom: 520 };
    return { width: 120, height: 32, left: 0, right: 120, top: 0, bottom: 32 };
  };
  window.addEventListener("message", (event) => messages.push(plain(event.data)));
  new Script(preloadSource, { filename: "preload.cjs" }).runInContext(context);
  await flush();
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flush();
  return {
    window, document, calls, messages, bridgeStates,
    listenerCounts: () => [...listeners.values()].map((callbacks) => callbacks.size),
    emitMutation(target, removedNodes = []) {
      for (const observer of observers.slice()) {
        if (observer.target === target || observer.options?.subtree && observer.target?.contains(target)) {
          observer.callback([{ target, addedNodes: [], removedNodes }]);
        }
      }
    },
    counter: () => document.querySelector(counterSelector),
    emit(value) { window.dispatchEvent(new window.CustomEvent("codex-workflow:usage", { detail: JSON.stringify(value) })); },
    async openSettings() {
      const nav = document.querySelector('[data-codex-workflow="nav-item"]');
      assert.ok(nav, "Workflow navigation mounted");
      nav.click();
      await flush();
      document.querySelector('[data-codex-workflow-section="usage"]')?.click();
      await flush();
    },
  };
}

test("usage window selection prefers 5h, supports weekly/monthly, and honors exhausted longer windows", () => {
  const context = createContext({ require: () => ({}), __codexWorkflowPreloadInstalled: true });
  new Script(preloadSource).runInContext(context);
  const select = (windows, extra = {}) => plain(context.selectUsageWindow({ windows, ...extra }));
  assert.deepEqual(select([allowance(10080, 60), allowance(300, 20)]), { remaining: 80, label: "5hr limit" });
  assert.deepEqual(select([allowance(10080, 25)]), { remaining: 75, label: "Weekly limit" });
  assert.deepEqual(select([allowance(43200, 35)]), { remaining: 65, label: "Monthly limit" });
  assert.deepEqual(select([allowance(28 * 1440, 35)]), { remaining: 65, label: "Monthly limit" });
  assert.deepEqual(select([allowance(300, 20), allowance(10080, 100)]), { remaining: 0, label: "Weekly limit" });
  assert.deepEqual(select([allowance(300, 20)], { blocked: true }), { remaining: 0, label: "5hr limit" });
  for (const value of [null, {}, { unavailable: true, windows: [allowance(300, 20)] }, { windows: [] },
    { windows: [allowance(300, "20")] }, { windows: [allowance(0, 20)] }, { windows: [allowance(300, 20, 1)] }]) {
    assert.equal(context.selectUsageWindow(value), null);
  }
});

for (const placement of ["toolbar", "composer"]) {
  test(`${placement} counter mounts beside native controls, labels its tooltip, and opens Usage`, async (t) => {
    const h = await createHarness(t, { placement });
    const button = h.counter();
    assert.ok(button);
    assert.equal(button.dataset.codexWorkflowUsage, placement);
    assert.equal(button.textContent, "—");
    assert.equal(button.getAttribute("aria-label"), "Usage unavailable. Open Usage settings");
    if (placement === "toolbar") {
      assert.equal(button.nextElementSibling.id, "share");
      assert.ok(button.classList.contains("rounded-lg"), "Uses the Share template rather than Back");
      assert.ok(button.classList.contains("px-1"), "Toolbar counter uses the native 4px padding token");
      assert.ok(!h.document.querySelector('#share').classList.contains('px-1'), "Native Share stays unchanged");
    }
    else {
      assert.ok(!button.classList.contains("px-1"), "Composer retains its native padding");
      assert.equal(button.previousElementSibling.id, "permissions");
      assert.equal(button.nextElementSibling.id, "model");
    }
    h.emit({ windows: [allowance(300, 27), allowance(10080, 40)] });
    assert.equal(button.textContent, "73%");
    assert.equal(button.getAttribute("aria-label"), "5hr limit: 73% remaining. Open Usage settings");
    button.focus();
    assert.equal(h.document.querySelector('[role="tooltip"]').textContent, "5hr limit");
    assert.equal(button.getAttribute("aria-describedby"), "codex-workflow-usage-tooltip");
    h.emit({ windows: [allowance(10080, 100)] });
    assert.equal(button.textContent, "0%");
    assert.equal(h.document.querySelector('[role="tooltip"]').textContent, "Weekly limit");
    h.emit({ windows: [allowance(300, 20, 1)] });
    assert.equal(button.textContent, "—");
    assert.equal(h.document.querySelector('[role="tooltip"]').textContent, "Usage unavailable");
    button.click();
    assert.deepEqual(h.messages, [{ type: "navigate-to-route", path: "/settings/usage" }]);
    assert.equal(h.document.querySelector('[role="tooltip"]'), null);
    assert.equal(h.document.querySelectorAll(counterSelector).length, 1);
  });
}

test("ambiguous native toolbars do not mount a usage counter", async (t) => {
  const h = await createHarness(t, { toolbarCount: 2 });
  assert.equal(h.counter(), null);
});

for (const showUsageRemaining of [true, false]) {
  test(`footer usage shares live values with toolbar enabled=${showUsageRemaining}`, async (t) => {
    const h = await createHarness(t, { footerUsage: true, showUsageRemaining });
    const footer = () => h.document.querySelector('[data-workflow-footer-shortcut]');
    assert.equal(footer().textContent, '—');
    assert.equal(footer().querySelector('svg'), null);
    assert.ok(footer().classList.contains('tabular-nums'));
    assert.ok(footer().classList.contains('text-sm'));
    assert.ok(footer().classList.contains('leading-[18px]'));
    assert.ok(!footer().classList.contains('size-8'));
    assert.deepEqual(h.bridgeStates, [true]);
    for (const [value, text] of [
      [{windows:[allowance(300, 27)]}, '73%'],
      [{windows:[allowance(10080, 100)]}, '0%'],
      [{unavailable:true}, '—'],
      [{windows:[allowance(300, 0)]}, '100%'],
    ]) {
      h.emit(value);
      assert.equal(footer().textContent, text);
      if (showUsageRemaining) assert.equal(h.counter().textContent, text);
      else assert.equal(h.counter(), null);
    }
    footer().click();
    assert.equal(h.messages.at(-1).path, '/settings/usage');
    footer().remove();
    h.emitMutation(h.document.querySelector('aside'));
    assert.equal(footer().textContent, '100%');
    await h.openSettings();
    [...h.document.querySelectorAll('[data-codex-workflow-panel] button')].find(button => button.textContent === 'Workflow').click();
    h.document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]').click();
    await flush();
    assert.equal(footer(), null);
    assert.deepEqual(h.bridgeStates, showUsageRemaining ? [true] : [true, false]);
    assert.notEqual(h.document.querySelector('[aria-label="Open help menu"]').style.display, 'none');
  });
}

test("usage toggle removes owned counter and tooltip and disables placement", async (t) => {
  const h = await createHarness(t);
  await h.openSettings();
  h.counter().focus();
  h.document.querySelector(toggleSelector).click();
  await flush();
  assert.equal(h.counter(), null);
  assert.equal(h.document.querySelector('[role="tooltip"]'), null);
  assert.equal(h.document.querySelector(toggleSelector).getAttribute("aria-checked"), "false");
  assert.equal(h.document.querySelector(locationSelector).disabled, true);
  assert.deepEqual(h.calls.filter((call) => call.channel.endsWith("settings:set")).map((call) => call.patch), [{ showUsageRemaining: false }]);
  h.emit({ windows: [allowance(300, 20)] });
  assert.equal(h.counter(), null);
  assert.ok(h.document.querySelector("#share"));
  assert.ok(h.document.querySelector("#permissions"));
});

for (const reject of [false, true]) {
  test(`usage placement menu ${reject ? "rolls back rejected persistence" : "persists and relocates the counter"}`, async (t) => {
    const h = await createHarness(t, { setSettings: reject ? () => { throw new Error("Injected write failure"); } : undefined });
    await h.openSettings();
    h.emit({ windows: [allowance(300, 30)] });
    const location = h.document.querySelector(locationSelector);
    location.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flush();
    const menu = h.document.querySelector(menuSelector);
    assert.ok(menu);
    assert.equal(location.getAttribute("aria-expanded"), "true");
    assert.equal(location.getAttribute("aria-controls"), menu.id);
    const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
    assert.deepEqual(items.map((item) => [item.textContent, item.getAttribute("aria-checked")]), [["Toolbar", "true"], ["Composer", "false"]]);
    assert.equal(menu.querySelectorAll('svg[aria-hidden="true"]').length, 1);
    assert.equal(h.calls.some((call) => call.channel === "codex_desktop:show-context-menu"), false);
    items[1].click();
    await flush();
    assert.deepEqual(h.calls.filter((call) => call.channel.endsWith("settings:set")).map((call) => call.patch), [{ usageRemainingLocation: "composer" }]);
    assert.equal(h.counter().dataset.codexWorkflowUsage, reject ? "toolbar" : "composer");
    assert.equal(h.counter().textContent, "70%");
    assert.equal(location.textContent, reject ? "Toolbar" : "Composer");
    assert.equal(location.disabled, false);
    assert.equal(location.getAttribute("aria-expanded"), "false");
    assert.equal(location.hasAttribute("aria-controls"), false);
    assert.equal(h.document.querySelector(menuSelector), null);
    assert.equal(h.document.activeElement, location);
    assert.equal(h.document.querySelectorAll(counterSelector).length, 1);
  });
}

test("usage menu keyboard, outside dismissal, route changes and settings unmount clean up ownership", async (t) => {
  const h = await createHarness(t);
  await h.openSettings();
  const baseline = h.listenerCounts();
  let location = h.document.querySelector(locationSelector);
  const key = (value) => h.document.activeElement.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
  const assertClosed = () => {
    assert.equal(h.document.querySelector(menuSelector), null);
    assert.equal(location.getAttribute("aria-expanded"), "false");
    assert.equal(location.hasAttribute("aria-controls"), false);
    assert.deepEqual(h.listenerCounts(), baseline);
  };
  for (const dismiss of ["Escape", "Tab"]) {
    location.focus();
    key("ArrowDown");
    assert.equal(h.document.activeElement.textContent, "Toolbar");
    assert.deepEqual(h.listenerCounts(), baseline.map((count) => count + 1));
    for (const [pressed, expected] of [["ArrowDown", "Composer"], ["ArrowUp", "Toolbar"], ["End", "Composer"], ["Home", "Toolbar"], ["c", "Composer"], ["t", "Toolbar"]]) {
      key(pressed);
      assert.equal(h.document.activeElement.textContent, expected);
    }
    key(dismiss);
    assertClosed();
    assert.equal(h.document.activeElement, location);
  }
  location.click();
  h.document.querySelector("#share").dispatchEvent(new h.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  assertClosed();
  location.click();
  h.window.history.pushState({}, "", "#usage-route-change");
  await flush();
  assertClosed();
  assert.equal(location.isConnected, false);
  await h.openSettings();
  location = h.document.querySelector(locationSelector);
  location.click();
  assert.ok(h.document.querySelector(menuSelector));
  const shell = h.document.querySelector("#settings-shell");
  const parent = shell.parentElement;
  shell.remove();
  h.emitMutation(parent, [shell]);
  await flush();
  assertClosed();
  assert.equal(h.calls.some((call) => call.channel.endsWith("settings:set") || call.channel === "codex_desktop:show-context-menu"), false);
});
