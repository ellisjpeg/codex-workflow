import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";

const preloadSource = readFileSync(new URL("../runtime/preload.cjs", import.meta.url), "utf8");

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

async function createHarness({ initialSettings, installUpdateResult, setSettings, updateStatus, getUpdateStatus, delayedRoots = false, nativeSidebar = false, realObservers = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <header id="top-toolbar" class="flex h-toolbar draggable">
      <div id="toolbar-actions" class="@container flex items-center">
        <button type="button" aria-label="Share"></button>
        <button type="button" aria-label="Toggle summary"></button>
        <button type="button" aria-label="Toggle bottom panel"></button>
        <button type="button" aria-label="Toggle top panel"></button>
      </div>
    </header>
    <aside class="app-shell-left-panel">
      <div id="sidebar-toolbar" class="h-toolbar w-full shrink-0 draggable"></div>
      <div id="pull-requests" class="sidebar-item" style="display: block !important" aria-hidden="false" tabindex="3">
        <a href="/pull-requests"><span class="text-fade-truncate">Pull requests</span></a>
      </div>
      <div class="min-w-0 flex-1">
        <button id="account-menu-trigger" type="button" aria-haspopup="menu" aria-label="Open profile menu">Account</button>
      </div>
      <button id="sidebar-help-trigger" type="button" aria-haspopup="menu" aria-label="Open help menu" class="size-8 shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
        <svg class="icon-sm" viewBox="0 0 20 20" fill="none"><path d="native-question" fill="currentColor"></path></svg>
      </button>
    </aside>
    <div id="primary-composer" role="presentation" data-composer-layout="multiline">
      <div id="composer-footer" class="_ComposerLayoutFooter_kbwao_2" data-composer-footer-responsive="" data-composer-layout="multiline" data-composer-rows="inline" data-composer-spacing="default">
        <div id="composer-expanding-controls" class="flex min-w-0 flex-1 justify-end">
          <button id="model-reasoning-selector" type="button" aria-label="Select model and reasoning"></button>
        </div>
        <div id="composer-actions" class="flex shrink-0 items-center gap-2">
          <button id="context-window-ring" type="button" aria-label="Context window"></button>
          <button id="composer-dictate" type="button" aria-label="Dictate" style="display: inline-flex !important" aria-hidden="false" tabindex="4"></button>
          <div id="composer-submit-slot" class="ms-2 flex items-center">
            <button id="composer-submit" type="button" aria-label="Send"></button>
          </div>
        </div>
      </div>
    </div>
    <button id="outside-dictate" type="button" aria-label="Dictate"></button>
    <div id="settings-shell">
      <nav aria-label="Settings">
        <button class="nav active" data-settings-panel-slug="general-settings" aria-current="page"><svg class="icon active"><path></path></svg><span class="text-fade-truncate active-label">General</span></button>
        <button class="nav inactive" data-settings-panel-slug="appearance"><svg class="icon inactive"><path></path></svg><span class="text-fade-truncate inactive-label">Appearance</span></button>
        <button class="nav inactive" data-settings-panel-slug="voice"><svg class="icon inactive"><path></path></svg><span class="text-fade-truncate inactive-label">Voice</span></button>
        <button class="nav inactive" data-settings-panel-slug="personalization"><svg class="icon inactive"><path></path></svg><span class="text-fade-truncate inactive-label">Personalization</span></button>
      </nav>
      <main id="settings-content"><section id="native-panel">Native settings</section></main>
    </div>
    <section id="response-stream"></section>
  </body></html>`, {
    url: "app://codex/settings",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const { document } = window;
  if (nativeSidebar) {
    const nav = document.querySelector("nav");
    nav.classList.add("sidebar-navigation");
    const sidebar = document.createElement("aside");
    sidebar.className = "app-shell-left-panel";
    nav.before(sidebar);
    sidebar.append(nav);
    const items = Array.from(nav.children);
    nav.innerHTML = `<div class="flex min-h-0 flex-1 flex-col"><input aria-label="Search settings"><div id="settings-scroll" class="min-h-0 flex-1 overflow-y-auto pb-2 flex flex-col gap-4"><div id="personal" class="flex flex-col gap-1"><div class="group/nav-section-title flex items-center justify-between gap-2 pe-0.5 ps-2"><div class="min-w-0 flex-1 text-base font-medium text-tertiary opacity-75">Personal</div></div><div class="flex flex-col gap-px browser:gap-0"></div></div><div id="integrations" class="flex flex-col gap-1"><div class="group/nav-section-title flex items-center justify-between gap-2 pe-0.5 ps-2"><div class="min-w-0 flex-1 text-base font-medium text-tertiary opacity-75">Integrations</div></div><div class="flex flex-col gap-px browser:gap-0"><button data-settings-panel-slug="mcp" aria-label="MCP servers" class="nav inactive"><span class="text-fade-truncate">MCP servers</span></button></div></div></div><footer>Fixed footer</footer></div>`;
    nav.querySelector("#personal").lastElementChild.append(...items);
  }
  const delayedSidebar = document.querySelector(".app-shell-left-panel");
  const delayedSettingsShell = document.querySelector("#settings-shell");
  if (delayedRoots) {
    delayedSidebar.remove();
    delayedSettingsShell.remove();
  }
  const observers = [];
  const intervalCalls = [];
  const timeoutCallbacks = new Map();
  const animationFrameCallbacks = [];
  const invokedChannels = [];
  let deferAnimationFrames = false;
  let nextTimer = 1;
  let deliveredMutationCallbacks = 0;
  let persistedSettings = initialSettings
    ? { ...initialSettings }
    : {
      schemaVersion: 2,
      focusedInterface: true,
      hidePullRequests: true,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
      hideComposerMicrophone: false,
    };
  const ipcRenderer = {
    invoke(channel, patch) {
      invokedChannels.push(channel);
      if (channel === "codex-workflow:settings:get") {
        return Promise.resolve({ ...persistedSettings });
      }
      if (channel === "codex-workflow:update:get") {
        if (getUpdateStatus) return getUpdateStatus();
        return Promise.resolve(updateStatus || { available: false });
      }
      if (channel === "codex-workflow:update:install") {
        if (installUpdateResult !== undefined) return Promise.resolve(installUpdateResult);
        return Promise.resolve({ ...(updateStatus || {}), applying: true });
      }
      if (channel === "codex-workflow:settings:activate") {
        if (patch.target !== "keyboard-shortcut") return Promise.reject(new Error("invalid activation"));
        document.dispatchEvent(new window.KeyboardEvent("keydown", {
          key: ",",
          code: "Comma",
          metaKey: true,
          bubbles: true,
        }));
        return Promise.resolve(true);
      }
      if (setSettings) return setSettings(patch);
      persistedSettings = { ...persistedSettings, ...patch, schemaVersion: 2 };
      return Promise.resolve({ ...persistedSettings });
    },
    on() {},
    send() {},
  };

  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches("nav")) return { width: 240, height: 420, left: 0, right: 240, top: 0, bottom: 420 };
    if (this.id === "settings-content") return { width: 640, height: 520, left: 240, right: 880, top: 0, bottom: 520 };
    return { width: 120, height: 32, left: 0, right: 120, top: 0, bottom: 32 };
  };

  const context = dom.getInternalVMContext();
  const NativeMutationObserver = window.MutationObserver;
  context.require = (name) => {
    if (name === "electron") return { ipcRenderer };
    throw new Error(`Unexpected preload require: ${name}`);
  };
  context.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      this.target = null;
      this.options = null;
      this.native = realObservers ? new NativeMutationObserver((records) => {
        deliveredMutationCallbacks += 1;
        if (deliveredMutationCallbacks > 60) { this.disconnect(); return; }
        callback(records);
      }) : null;
      observers.push(this);
    }

    observe(target, options) {
      this.active = true;
      this.target = target;
      this.options = options;
      this.native?.observe(target, options);
    }

    disconnect() {
      this.active = false;
      this.native?.disconnect();
    }
  };
  context.setInterval = (...args) => {
    intervalCalls.push(args);
    return nextTimer++;
  };
  context.clearInterval = () => {};
  context.setTimeout = (callback) => {
    const id = nextTimer++;
    timeoutCallbacks.set(id, callback);
    return id;
  };
  context.clearTimeout = (id) => timeoutCallbacks.delete(id);
  context.requestAnimationFrame = (callback) => {
    if (deferAnimationFrames) animationFrameCallbacks.push(callback);
    else callback();
    return nextTimer++;
  };
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });

  const nav = document.querySelector("nav") || delayedSettingsShell.querySelector("nav");
  nav.addEventListener("keydown", (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const item = event.target.closest("[data-settings-panel-slug]");
    if (!item) return;
    event.preventDefault();
    const items = Array.from(nav.querySelectorAll("[data-settings-panel-slug]"));
    const next = items[items.indexOf(item) + (event.key === "ArrowDown" ? 1 : -1)];
    next?.focus();
    next?.click();
  });
  nav.addEventListener("click", (event) => {
    const item = event.target.closest("[data-settings-panel-slug]");
    if (!item || item.dataset.codexWorkflow === "nav-item") return;
    for (const entry of nav.querySelectorAll("[data-settings-panel-slug]")) {
      entry.className = "nav inactive";
      entry.removeAttribute("aria-current");
    }
    item.className = "nav active";
    item.setAttribute("aria-current", "page");
  });

  new Script(preloadSource, { filename: "preload.cjs" }).runInContext(context);
  await flush();
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flush();
  const emitMutation = (target, { addedNodes = [], removedNodes = [] } = {}) => {
    const record = { target, addedNodes, removedNodes };
    for (const observer of observers.slice()) {
      if (!observer.active || !observer.target) continue;
      const inScope = observer.target === target ||
        (observer.options?.subtree && observer.target.contains(target));
      if (inScope) {
        deliveredMutationCallbacks += 1;
        observer.callback([record], observer);
      }
    }
  };

  return {
    dom,
    window,
    document,
    nav,
    ipcRenderer,
    invokedChannels,
    observers,
    intervalCalls,
    timeoutCallbacks,
    runNextTimeout: () => {
      const entry = timeoutCallbacks.entries().next().value;
      if (!entry) return false;
      timeoutCallbacks.delete(entry[0]);
      entry[1]();
      return true;
    },
    mountDelayedRoots: () => {
      document.body.prepend(delayedSidebar);
      document.body.appendChild(delayedSettingsShell);
      emitMutation(document.body, { addedNodes: [delayedSidebar, delayedSettingsShell] });
    },
    emitMutation,
    deliveredMutationCallbacks: () => deliveredMutationCallbacks,
    deferAnimationFrames: () => {
      deferAnimationFrames = true;
    },
    flushAnimationFrame: () => {
      const callbacks = animationFrameCallbacks.splice(0);
      for (const callback of callbacks) callback();
    },
    resumeAnimationFrames: () => {
      deferAnimationFrames = false;
    },
  };
}

test("sidebar editing hides navigation only, keeps Workflow reachable, and restores exact nodes", async () => {
  const harness = await createHarness({ nativeSidebar: true });
  try {
    const { document, nav } = harness;
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    const appearance = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const parent = appearance.parentElement;
    appearance.setAttribute("style", "display: inline-flex !important");
    appearance.setAttribute("aria-hidden", "false");
    const before = appearance.outerHTML;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const edit = document.querySelector('[data-codex-workflow="sidebar-edit"]');
    assert.equal(edit.textContent, "Customise");
    assert.equal(document.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    edit.click();
    assert.equal(edit.textContent, "Done");
    assert.equal(nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length, 5);
    assert.equal(nav.querySelector('[aria-label="Hide Workflow"]'), null);
    assert.equal(appearance.parentElement, parent);
    nav.querySelector('[aria-label="Hide Appearance"]').click();
    await flush();
    const group = nav.querySelector('[data-codex-workflow="hidden-pages"]');
    assert.equal(group.previousElementSibling.id, "integrations");
    assert.equal(group.parentElement.id, "settings-scroll");
    assert.equal(group.querySelector("button").getAttribute("aria-expanded"), "true");
    assert.equal(document.querySelector('[data-codex-workflow-panel]').isConnected, true);
    assert.equal(general.getAttribute("aria-current"), null);
    assert.equal(appearance.style.display, "none");
    assert.equal(appearance.getAttribute("aria-hidden"), "true");
    nav.querySelector('[aria-label="Restore Appearance"]').click();
    await flush();
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    edit.click();
    assert.equal(appearance.outerHTML, before);
    assert.equal(nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length, 0);
    edit.click();
    appearance.style.display = "grid";
    appearance.style.color = "red";
    appearance.setAttribute("aria-hidden", "false");
    edit.click();
    assert.equal(appearance.style.display, "grid");
    assert.equal(appearance.style.color, "red");
    assert.equal(appearance.getAttribute("aria-hidden"), "false");
  } finally { harness.dom.window.close(); }
});

test("hidden current pages remain open and disclosure navigation never restores preferences", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["general-settings", "workflow", "mcp", "mcp", 42] } });
  try {
    const { document, nav, invokedChannels, emitMutation } = harness;
    const panel = document.querySelector("#native-panel");
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    assert.equal(general.getAttribute("aria-current"), "page");
    assert.equal(panel.style.display, "");
    assert.equal(nav.querySelector('[data-settings-panel-slug="workflow"]').style.display, "");
    const group = nav.querySelector('[data-codex-workflow="hidden-pages"]');
    const disclosure = group.querySelector("button");
    assert.equal(disclosure.getAttribute("aria-expanded"), "false");
    assert.equal(group.lastElementChild.hidden, true);
    disclosure.click();
    assert.equal(group.lastElementChild.hidden, false);
    assert.equal(group.querySelectorAll('[data-codex-workflow-page]').length, 2);
    const proxy = group.querySelector('[data-codex-workflow-page="mcp"]');
    proxy.click();
    await flush();
    assert.equal(nav.querySelector('[data-settings-panel-slug="mcp"]').getAttribute("aria-current"), "page");
    assert.equal(panel.style.display, "");
    assert.equal(general.style.display, "none");
    assert.equal(invokedChannels.includes("codex-workflow:settings:set"), false);
    for (let index = 0; index < 4; index += 1) emitMutation(nav, { addedNodes: [proxy] });
    assert.equal(nav.querySelectorAll('[data-codex-workflow="hidden-pages"]').length, 1);
    assert.equal(nav.querySelectorAll('[data-codex-workflow-page="mcp"]').length, 1);
    group.querySelector('[data-codex-workflow-page="mcp"]').focus();
    disclosure.click();
    assert.equal(document.activeElement, disclosure);
    assert.equal(group.lastElementChild.hidden, true);
  } finally { harness.dom.window.close(); }
});

test("sidebar IPC failure rolls back and concurrent writes cannot overwrite other settings", async () => {
  let rejectWrite;
  const writes = [];
  const harness = await createHarness({ nativeSidebar: true, setSettings: (patch) => {
    writes.push(patch);
    return new Promise((_resolve, reject) => { rejectWrite = reject; });
  } });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    const hide = nav.querySelector('[aria-label="Hide Voice"]');
    hide.click();
    assert.equal(hide.disabled, true);
    assert.equal(document.querySelector('[role="switch"]').disabled, true);
    nav.querySelector('[aria-label="Hide Appearance"]').click();
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { hiddenSettingsPages: ["voice"] });
    rejectWrite(new Error("disk full"));
    await flush();
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    assert.ok(nav.querySelector('[aria-label="Hide Voice"]'));
    assert.equal(document.querySelector('[role="switch"]').disabled, false);
  } finally { harness.dom.window.close(); }
});

test("native search results remain untouched and open hidden pages without unhiding", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { document, nav, emitMutation, invokedChannels } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const owner = document.querySelector("#settings-scroll");
    const savedGroups = [...owner.children].filter((element) => element.id === "personal" || element.id === "integrations");
    owner.replaceChildren();
    const result = document.createElement("button");
    result.dataset.listNavigationItem = "true";
    result.textContent = "Voice";
    result.addEventListener("click", () => { document.querySelector("#native-panel").textContent = "Voice settings"; });
    owner.append(result);
    emitMutation(owner, { addedNodes: [result] });
    assert.ok(nav.querySelector('[data-settings-panel-slug="workflow"]'));
    assert.equal(result.style.display, "");
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    result.click();
    await flush();
    assert.equal(document.querySelector("#native-panel").style.display, "");
    assert.equal(document.querySelector("#native-panel").textContent, "Voice settings");
    owner.replaceChildren(...savedGroups);
    emitMutation(owner, { addedNodes: savedGroups });
    assert.equal(nav.querySelector('[data-settings-panel-slug="voice"]').style.display, "none");
    assert.equal(invokedChannels.includes("codex-workflow:settings:set"), false);
  } finally { harness.dom.window.close(); }
});

test("sidebar proxies sanitize identity, skip hidden rows with arrows, and preserve section layout", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { document, nav, window, emitMutation } = harness;
    const appearance = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    const groups = [document.querySelector("#personal"), document.querySelector("#integrations")];
    const footer = nav.querySelector("footer");
    const originalParents = groups.map((group) => group.parentElement);
    appearance.querySelector("span").id = "native-label";
    appearance.setAttribute("aria-describedby", "native-label");
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    emitMutation(nav, { addedNodes: [] });
    assert.equal(document.querySelectorAll("#native-label").length, 1);
    assert.equal(nav.querySelector('[data-codex-workflow-page="appearance"]').hasAttribute("aria-describedby"), false);
    for (const control of nav.querySelectorAll('[data-codex-workflow="sidebar-row"] button')) {
      assert.equal(control.querySelector("button"), null);
      assert.ok(control.getAttribute("aria-label") || control.textContent);
    }
    assert.equal(nav.querySelector('[aria-label="Hide Appearance"]').style.position, "absolute");
    groups.forEach((group, index) => assert.equal(group.parentElement, originalParents[index]));
    assert.equal(footer.parentElement.lastElementChild, footer);
    assert.equal(general.parentElement.id, "");
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    const disclosure = nav.querySelector('[data-codex-workflow="hidden-pages"] button');
    disclosure.click();
    const workflow = nav.querySelector('[data-settings-panel-slug="workflow"]');
    workflow.focus();
    workflow.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    assert.equal(document.activeElement.dataset.settingsPanelSlug, "personalization");
    assert.equal(nav.querySelector('[data-settings-panel-slug="voice"]').style.display, "none");
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]').className.includes("sticky"), false);
  } finally { harness.dom.window.close(); }
});

test("hidden pages survive native remounts and repeated sidebar synchronization", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["appearance"] } });
  try {
    const { nav, emitMutation } = harness;
    const original = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const replacement = original.cloneNode(true);
    replacement.removeAttribute("style");
    replacement.removeAttribute("aria-hidden");
    original.replaceWith(replacement);
    replacement.focus();
    emitMutation(replacement.parentElement, { addedNodes: [replacement], removedNodes: [original] });
    assert.equal(replacement.style.display, "none");
    assert.equal(original.style.display, "");
    assert.equal(harness.document.activeElement, nav.querySelector('[data-codex-workflow="hidden-pages"] button'));
    const count = nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length;
    for (let index = 0; index < 5; index += 1) emitMutation(nav, { addedNodes: [] });
    assert.equal(nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length, count);
    assert.equal(nav.querySelectorAll('[data-codex-workflow-page="appearance"]').length, 1);
    assert.equal(nav.querySelectorAll('[data-codex-workflow="nav-item"]').length, 1);
  } finally { harness.dom.window.close(); }
});

test("sidebar mutations settle with real observers and hiding the current page never navigates", async () => {
  const harness = await createHarness({ nativeSidebar: true, realObservers: true });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    nav.querySelector('[data-codex-workflow-page="appearance"]').click();
    await flush();
    const panel = document.querySelector("#native-panel");
    const originalContent = panel.outerHTML;
    nav.querySelector('[aria-label="Hide Appearance"]').click();
    await flush();
    assert.equal(panel.outerHTML, originalContent);
    assert.equal(nav.querySelector('[data-settings-panel-slug="appearance"]').getAttribute("aria-current"), "page");
    assert.ok(harness.deliveredMutationCallbacks() < 30);
    const settled = harness.deliveredMutationCallbacks();
    await flush();
    assert.equal(harness.deliveredMutationCallbacks(), settled);
    const duplicate = nav.querySelector('[data-settings-panel-slug="appearance"]').cloneNode(true);
    duplicate.removeAttribute("style");
    duplicate.removeAttribute("aria-hidden");
    document.querySelector("#integrations").lastElementChild.append(duplicate);
    await flush();
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    assert.equal(nav.querySelectorAll('[data-codex-workflow="sidebar-row"]').length, 0);
  } finally {
    harness.observers.forEach((observer) => observer.disconnect());
    harness.dom.window.close();
  }
});

test("sidebar disclosure matches its muted heading and edit circles sit inside the row padding", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { nav, document } = harness;
    const glyph = nav.querySelector('[data-codex-workflow="hidden-pages"] button svg');
    assert.ok(glyph.classList.contains("text-tertiary"));
    assert.ok(glyph.classList.contains("opacity-75"));
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    for (const label of ["Hide Appearance", "Restore Voice"]) {
      const action = nav.querySelector(`[aria-label="${label}"]`);
      assert.ok(action.classList.contains("size-6"));
      assert.ok(action.firstElementChild.classList.contains("size-4"));
      assert.equal(action.style.insetInlineEnd, "var(--padding-row-x)");
      assert.equal(action.previousElementSibling.style.paddingInlineEnd, "calc(var(--height-token-row) + var(--padding-row-x))");
    }
  } finally { harness.dom.window.close(); }
});

test("hide and restore preserve the viewport including user scrolling during persistence", async () => {
  let resolveWrite;
  const harness = await createHarness({ nativeSidebar: true, setSettings: (patch) =>
    new Promise((resolve) => { resolveWrite = () => resolve(patch); }) });
  try {
    const { nav, document, window } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-edit"]').click();
    const owner = document.querySelector("#settings-scroll");
    const nativeFocus = window.HTMLElement.prototype.focus;
    window.HTMLElement.prototype.focus = function (options) {
      if (this.closest("#settings-scroll") && !options?.preventScroll) owner.scrollTop = 999;
      nativeFocus.call(this, options);
    };
    for (const label of ["Hide Appearance", "Restore Appearance"]) {
      owner.scrollTop = 80;
      nav.querySelector(`[aria-label="${label}"]`).click();
      assert.equal(owner.scrollTop, 80);
      owner.scrollTop = 120;
      resolveWrite();
      await flush();
      assert.equal(owner.scrollTop, 120);
    }
  } finally { harness.dom.window.close(); }
});

test("empty native sidebar sections disappear and restore exactly without hiding unowned destinations", async () => {
  const harness = await createHarness({ nativeSidebar: true });
  try {
    const { document, nav, emitMutation } = harness;
    const section = document.querySelector("#integrations");
    section.setAttribute("style", "display: grid !important; color: red");
    section.setAttribute("aria-hidden", "false");
    const original = section.outerHTML;
    const owner = section.parentElement;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const edit = document.querySelector('[data-codex-workflow="sidebar-edit"]');
    edit.click();
    nav.querySelector('[aria-label="Hide MCP servers"]').click();
    await flush();
    assert.equal(section.style.display, "none");
    assert.equal(section.getAttribute("aria-hidden"), "true");
    assert.equal(section.parentElement, owner);
    assert.equal(section.nextElementSibling.dataset.codexWorkflow, "hidden-pages");
    assert.equal(document.querySelector("#personal").style.display, "");
    for (const html of ['<button disabled>Unavailable</button>', '<a href="https://example.test">External</a>', '<button>Extension settings</button>']) {
      section.lastElementChild.insertAdjacentHTML("beforeend", html);
      const extra = section.lastElementChild.lastElementChild;
      emitMutation(section, { addedNodes: [extra] });
      assert.equal(section.style.display, "grid");
      extra.remove();
      emitMutation(section, { removedNodes: [extra] });
      assert.equal(section.style.display, "none");
    }
    nav.querySelector('[aria-label="Restore MCP servers"]').click();
    await flush();
    edit.click();
    assert.equal(section.outerHTML, original);
    assert.equal(nav.querySelector("footer").parentElement.lastElementChild.tagName, "FOOTER");
  } finally { harness.dom.window.close(); }
});

test("Revert remains available outside editing and resets only sidebar choices", async () => {
  const initialSettings = { hiddenSettingsPages: ["voice", "mcp", "future-page"], focusedInterface: false, hideComposerMicrophone: true };
  const harness = await createHarness({ nativeSidebar: true, initialSettings });
  try {
    const { document, nav, ipcRenderer, invokedChannels } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const revert = document.querySelector('[data-codex-workflow="sidebar-revert"]');
    const edit = document.querySelector('[data-codex-workflow="sidebar-edit"]');
    assert.ok(revert);
    assert.equal(revert.parentElement, edit.parentElement);
    assert.equal(revert.textContent, "Revert");
    assert.equal(revert.getAttribute("aria-label"), "Revert settings sidebar to default");
    assert.ok(revert.classList.contains("text-chart-red"));
    assert.ok(revert.classList.contains("bg-chart-red/10"));
    revert.focus();
    revert.click();
    assert.equal(revert.disabled, true);
    await flush();
    assert.equal(document.activeElement, revert);
    assert.equal(edit.textContent, "Customise");
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"]'), null);
    assert.equal(nav.querySelector('[data-settings-panel-slug="voice"]').style.display, "");
    assert.equal(document.querySelector("#integrations").hasAttribute("style"), false);
    const saved = await ipcRenderer.invoke("codex-workflow:settings:get");
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), { ...initialSettings, schemaVersion: 2, hiddenSettingsPages: [] });
    revert.click();
    assert.equal(invokedChannels.filter((channel) => channel === "codex-workflow:settings:set").length, 1);
    edit.click();
    nav.querySelector('[aria-label="Hide Voice"]').click();
    await flush();
    assert.equal(revert.disabled, false);
    revert.click();
    await flush();
    assert.equal(edit.textContent, "Done");
    assert.ok(nav.querySelector('[aria-label="Hide Voice"]'));
    assert.equal(nav.querySelector('[aria-label="Hide Workflow"]'), null);
  } finally { harness.dom.window.close(); }
});

test("Revert serializes writes and rolls rows and headers back on persistence failure", async () => {
  let rejectWrite;
  const writes = [];
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["mcp"] }, setSettings: (patch) => {
    writes.push(patch);
    return new Promise((_resolve, reject) => { rejectWrite = reject; });
  } });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const revert = document.querySelector('[data-codex-workflow="sidebar-revert"]');
    assert.ok(revert);
    revert.click();
    revert.click();
    document.querySelector('[role="switch"]').click();
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { hiddenSettingsPages: [] });
    assert.equal(document.querySelector("#integrations").style.display, "");
    rejectWrite(new Error("disk full"));
    await flush();
    assert.equal(revert.disabled, false);
    assert.equal(document.querySelector("#integrations").style.display, "none");
    assert.equal(nav.querySelector('[data-settings-panel-slug="mcp"]').style.display, "none");
    assert.equal(nav.querySelector('[data-codex-workflow="hidden-pages"] button').getAttribute("aria-expanded"), "false");
  } finally { harness.dom.window.close(); }
});

test("hidden settings and empty headings are suppressed before paint on delayed mounts and remounts", async () => {
  const harness = await createHarness({ nativeSidebar: true, delayedRoots: true, realObservers: true, initialSettings: { hiddenSettingsPages: ["voice", "mcp"] } });
  try {
    const { document, window, nav, deferAnimationFrames, flushAnimationFrame } = harness;
    const replacementShell = nav.closest("#settings-shell").cloneNode(true);
    const replacementVoice = nav.querySelector('[data-settings-panel-slug="voice"]').cloneNode(true);
    const assertSuppressed = () => {
      assert.equal(document.querySelector('[data-settings-panel-slug="voice"]').style.display, "none");
      assert.equal(document.querySelector("#integrations").style.display, "none");
      assert.equal(document.querySelectorAll('[data-codex-workflow="hidden-pages"]').length, 1);
    };
    deferAnimationFrames();
    window.requestAnimationFrame(harness.mountDelayedRoots);
    flushAnimationFrame();
    await flush();
    assertSuppressed();
    window.requestAnimationFrame(() => document.querySelector("#settings-shell").replaceWith(replacementShell));
    flushAnimationFrame();
    await flush();
    assertSuppressed();
    window.requestAnimationFrame(() => document.querySelector('[data-settings-panel-slug="voice"]').replaceWith(replacementVoice));
    flushAnimationFrame();
    await flush();
    assertSuppressed();
    harness.resumeAnimationFrames();
    flushAnimationFrame();
    await flush();
    const settled = harness.deliveredMutationCallbacks();
    await flush();
    assert.equal(harness.deliveredMutationCallbacks(), settled);
    assert.ok(settled < 60);
    assert.equal(harness.observers.some((observer) => observer.active && observer.target === document.documentElement), false);
  } finally {
    harness.observers.forEach((observer) => observer.disconnect());
    harness.dom.window.close();
  }
});

test("Done collapses Hidden without restoring pages or navigating away", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { document, nav, invokedChannels } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const edit = document.querySelector('[data-codex-workflow="sidebar-edit"]');
    const group = nav.querySelector('[data-codex-workflow="hidden-pages"]');
    const disclosure = group.querySelector("button");
    edit.click();
    assert.equal(disclosure.getAttribute("aria-expanded"), "true");
    edit.focus();
    edit.click();
    assert.equal(disclosure.getAttribute("aria-expanded"), "false");
    assert.equal(group.lastElementChild.hidden, true);
    assert.equal(document.activeElement, edit);
    assert.ok(document.querySelector('[data-codex-workflow-panel]'));
    assert.equal(nav.querySelector('[data-settings-panel-slug="voice"]').style.display, "none");
    assert.equal(invokedChannels.includes("codex-workflow:settings:set"), false);
    disclosure.click();
    assert.equal(group.lastElementChild.hidden, false);
    edit.click();
    edit.click();
    assert.equal(group.lastElementChild.hidden, true);
  } finally { harness.dom.window.close(); }
});

test("saved visibility survives attribute-only native resets before any observer or frame runs", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice", "mcp"] } });
  try {
    const { document, window, nav } = harness;
    harness.deferAnimationFrames();
    const voice = nav.querySelector('[data-settings-panel-slug="voice"]');
    const section = document.querySelector("#integrations");
    voice.style.display = "";
    section.style.display = "";
    nav.parentElement.style.display = "none";
    nav.parentElement.style.display = "";
    assert.equal(window.getComputedStyle(voice).display, "none");
    assert.equal(window.getComputedStyle(section).display, "none");
    assert.notEqual(window.getComputedStyle(nav.querySelector('[data-settings-panel-slug="workflow"]')).display, "none");
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('[data-codex-workflow="sidebar-revert"]').click();
    await flush();
    assert.notEqual(window.getComputedStyle(voice).display, "none");
    assert.notEqual(window.getComputedStyle(section).display, "none");
  } finally { harness.dom.window.close(); }
});

test("first-paint visibility does not depend on Settings geometry or slow update IPC", async () => {
  let resolveUpdate;
  const harness = await createHarness({ nativeSidebar: true, delayedRoots: true,
    initialSettings: { hiddenSettingsPages: ["voice", "mcp"] },
    getUpdateStatus: () => new Promise((resolve) => { resolveUpdate = resolve; }),
  });
  try {
    const { document, window, nav } = harness;
    nav.getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 });
    harness.deferAnimationFrames();
    harness.mountDelayedRoots();
    const voice = nav.querySelector('[data-settings-panel-slug="voice"]');
    assert.equal(window.getComputedStyle(voice).display, "none");
    assert.equal(window.getComputedStyle(document.querySelector("#integrations")).display, "none");
    assert.equal(nav.querySelector('[data-codex-workflow="nav-item"]'), null);
    resolveUpdate({ available: false });
    await flush();
    assert.equal(window.getComputedStyle(voice).display, "none");
    delete nav.getBoundingClientRect;
    harness.resumeAnimationFrames();
    harness.flushAnimationFrame();
    await flush();
    assert.equal(nav.querySelectorAll('[data-codex-workflow="nav-item"]').length, 1);
    assert.equal(nav.querySelectorAll('[data-codex-workflow-page="voice"]').length, 1);
    assert.equal(voice.style.display, "none");
  } finally { harness.dom.window.close(); }
});

test("visibility CSS excludes lookalikes, search and disabled rows, and preserves native hiding", async () => {
  const harness = await createHarness({ nativeSidebar: true, initialSettings: { hiddenSettingsPages: ["voice"] } });
  try {
    const { document, window, nav, emitMutation } = harness;
    document.body.insertAdjacentHTML("beforeend", `<nav class="sidebar-navigation" aria-label="Settings"><button id="outside-voice" data-settings-panel-slug="voice">Voice</button></nav><div role="dialog"><aside class="app-shell-left-panel"><nav class="sidebar-navigation" aria-label="Settings"><button id="dialog-voice" data-settings-panel-slug="voice">Voice</button></nav></aside></div>`);
    const owner = document.querySelector("#settings-scroll");
    owner.insertAdjacentHTML("beforeend", '<button id="search-voice" data-list-navigation-item>Voice</button><button id="disabled-voice" data-settings-panel-slug="voice" disabled>Voice</button>');
    for (const id of ["outside-voice", "dialog-voice", "search-voice", "disabled-voice"]) {
      assert.notEqual(window.getComputedStyle(document.getElementById(id)).display, "none");
    }
    const style = document.createElement("style");
    style.textContent = ".native-hidden { display: none; }";
    document.head.append(style);
    const original = nav.querySelector('[data-settings-panel-slug="voice"]');
    const replacement = document.createElement("button");
    replacement.className = "native-hidden";
    replacement.dataset.settingsPanelSlug = "voice";
    replacement.textContent = "Voice";
    original.replaceWith(replacement);
    emitMutation(replacement.parentElement, { addedNodes: [replacement], removedNodes: [original] });
    assert.equal(nav.querySelector('[data-codex-workflow-page="voice"]'), null);
    assert.equal(replacement.style.display, "");
    assert.equal(window.getComputedStyle(replacement).display, "none");
    assert.equal(nav.hasAttribute("data-codex-workflow-sidebar-measuring"), false);
    assert.equal(document.querySelectorAll('style[data-codex-workflow="sidebar-visibility"]').length, 1);
  } finally { harness.dom.window.close(); }
});

test("Workflow Update uses the native sidebar hover-reveal pill", async () => {
  const harness = await createHarness({
    updateStatus: {
      available: true,
      installedVersion: "0.5.0",
      availableVersion: "0.5.1",
    },
  });
  try {
    const { document, window, emitMutation, invokedChannels } = harness;
    const toolbar = document.querySelector("#sidebar-toolbar");
    const pill = document.querySelector('[data-codex-workflow-update="true"]');
    const slot = document.querySelector('[data-codex-workflow-update-slot="true"]');
    assert.ok(pill);
    assert.equal(slot.parentElement, toolbar);
    assert.equal(pill.parentElement, slot);
    assert.ok(slot.className.includes("pointer-events-auto"));
    assert.ok(slot.className.includes("justify-end"));
    assert.ok(slot.className.includes("px-panel"));
    assert.equal(pill.getAttribute("aria-label"), "Workflow Update");
    assert.ok(pill.className.includes("bg-chart-blue"));
    assert.ok(pill.className.includes("pointer-events-auto"));
    assert.ok(pill.className.includes("grid-cols-[0fr]"));
    assert.ok(pill.className.includes("hover:grid-cols-[1fr]"));
    assert.ok(pill.querySelector('[data-codex-workflow-update-icon="true"]').className.includes("group-hover:opacity-0"));
    assert.ok(pill.querySelector('[data-codex-workflow-update-sliding-label="true"]').className.includes("group-hover:translate-x-0"));
    assert.equal(
      pill.querySelector('[data-codex-workflow-update-label="true"]').textContent,
      "Workflow Update",
    );

    const actions = document.querySelector("#toolbar-actions");
    const share = actions.querySelector('[aria-label="Share"]');
    const summary = actions.querySelector('[aria-label="Toggle summary"]');
    share.remove();
    summary.remove();
    emitMutation(document.querySelector("#top-toolbar"), { removedNodes: [share, summary] });
    await flush();
    assert.equal(pill.parentElement, slot);

    pill.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();
    assert.ok(invokedChannels.includes("codex-workflow:update:install"));
    assert.equal(pill.disabled, true);
    assert.equal(pill.getAttribute("aria-label"), "Installing Workflow Update");
  } finally {
    harness.dom.window.close();
  }
});

test("Workflow Update follows the current global titlebar sidebar region", async () => {
  const harness = await createHarness({
    updateStatus: {
      available: true,
      installedVersion: "0.5.3",
      availableVersion: "0.5.4",
    },
  });
  try {
    const { document, emitMutation } = harness;
    const sidebar = document.querySelector(".app-shell-left-panel");
    sidebar.getBoundingClientRect = () => ({
      width: 275, height: 763, left: 0, right: 275, top: 0, bottom: 763,
    });
    const legacyToolbar = document.querySelector("#sidebar-toolbar");
    legacyToolbar.remove();
    emitMutation(sidebar, { removedNodes: [legacyToolbar] });
    await flush();
    assert.equal(document.querySelector('[data-codex-workflow-update="true"]'), null);

    const titlebar = document.querySelector("#top-toolbar");
    const dormantTitlebar = titlebar.cloneNode(false);
    dormantTitlebar.id = "dormant-top-toolbar";
    dormantTitlebar.innerHTML = '<div id="dormant-sidebar-region" style="visibility: hidden"></div>';
    dormantTitlebar.getBoundingClientRect = () => ({
      width: 1200, height: 46, left: 0, right: 1200, top: 0, bottom: 46,
    });
    const dormantRegion = dormantTitlebar.firstElementChild;
    dormantRegion.getBoundingClientRect = () => ({
      width: 275, height: 46, left: 0, right: 275, top: 0, bottom: 46,
    });
    titlebar.before(dormantTitlebar);
    titlebar.innerHTML = `
      <div id="sidebar-titlebar-region">
        <div id="sidebar-titlebar-controls-wrapper">
          <div id="sidebar-titlebar-controls" class="inline-flex h-full items-center pointer-events-none w-full">
            <button aria-label="Hide sidebar"></button>
            <button aria-label="Back"></button>
            <button aria-label="Forward"></button>
          </div>
        </div>
      </div>
      <div id="main-titlebar-region"></div>
    `;
    titlebar.getBoundingClientRect = () => ({
      width: 1200, height: 46, left: 0, right: 1200, top: 0, bottom: 46,
    });
    const region = titlebar.querySelector("#sidebar-titlebar-region");
    region.getBoundingClientRect = () => ({
      width: 275, height: 46, left: 0, right: 275, top: 0, bottom: 46,
    });
    const controls = titlebar.querySelector("#sidebar-titlebar-controls");
    const controlsWrapper = titlebar.querySelector("#sidebar-titlebar-controls-wrapper");
    const nativeControls = Array.from(controls.children);
    controlsWrapper.getBoundingClientRect = () => ({
      width: 275, height: 46, left: 0, right: 275, top: 0, bottom: 46,
    });
    controls.style.display = "inline-flex";
    controls.getBoundingClientRect = () => ({
      width: 187, height: 46, left: 88, right: 275, top: 0, bottom: 46,
    });
    emitMutation(titlebar, { addedNodes: [region] });
    await flush();

    const slot = document.querySelector('[data-codex-workflow-update-slot="true"]');
    const pill = document.querySelector('[data-codex-workflow-update="true"]');
    assert.equal(slot.parentElement, controls);
    assert.equal(slot.className.includes("no-drag"), true);
    assert.equal(slot.className.includes("fixed"), true);
    assert.equal(slot.className.includes("pe-3"), true);
    assert.equal(slot.className.includes("flex-1"), false);
    assert.equal(slot.className.includes("px-panel"), false);
    assert.deepEqual(Array.from(controls.children).slice(0, 3), nativeControls);
    assert.equal(slot.style.left, "0px");
    assert.equal(slot.style.top, "0px");
    assert.equal(slot.style.width, "275px");
    assert.equal(slot.style.height, "46px");
    assert.equal(pill.getAttribute("aria-label"), "Workflow Update");
    assert.equal(
      pill.querySelector('[data-codex-workflow-update-label="true"]').textContent,
      "Update",
    );

    slot.remove();
    emitMutation(controls, { removedNodes: [slot] });
    await flush();
    assert.equal(
      document.querySelectorAll('[data-codex-workflow-update="true"]').length,
      1,
    );

    const replacement = titlebar.cloneNode(true);
    replacement.id = "replacement-top-toolbar";
    replacement.querySelectorAll('[data-codex-workflow-update-slot="true"]').forEach((element) => element.remove());
    replacement.getBoundingClientRect = titlebar.getBoundingClientRect;
    const replacementRegion = replacement.querySelector("#sidebar-titlebar-region");
    replacementRegion.getBoundingClientRect = region.getBoundingClientRect;
    const replacementControls = replacement.querySelector("#sidebar-titlebar-controls");
    replacementControls.getBoundingClientRect = controls.getBoundingClientRect;
    const replacementControlsWrapper = replacement.querySelector("#sidebar-titlebar-controls-wrapper");
    replacementControlsWrapper.getBoundingClientRect = controlsWrapper.getBoundingClientRect;
    titlebar.replaceWith(replacement);
    emitMutation(document.body, { addedNodes: [replacement], removedNodes: [titlebar] });
    await flush();

    assert.equal(
      replacementControls.querySelectorAll('[data-codex-workflow-update="true"]').length,
      1,
    );
  } finally {
    harness.dom.window.close();
  }
});

test("Workflow Update is absent when no newer Workflow release exists", async () => {
  const harness = await createHarness({ updateStatus: { available: false } });
  try {
    assert.equal(
      harness.document.querySelector('[data-codex-workflow-update="true"]'),
      null,
    );
  } finally {
    harness.dom.window.close();
  }
});

test("stale Workflow Update disappears when the main process reports no update", async () => {
  const harness = await createHarness({
    updateStatus: {
      available: true,
      installedVersion: "0.5.3",
      availableVersion: "0.5.4",
    },
    installUpdateResult: { available: false },
  });
  try {
    const { document, invokedChannels, window } = harness;
    const pill = document.querySelector('[data-codex-workflow-update="true"]');
    assert.ok(pill);

    pill.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    assert.ok(invokedChannels.includes("codex-workflow:update:install"));
    assert.equal(document.querySelector('[data-codex-workflow-update="true"]'), null);
    assert.equal(document.querySelector('[data-codex-workflow-update-slot="true"]'), null);
  } finally {
    harness.dom.window.close();
  }
});

test("Workflow participates in native keyboard navigation and clones active styling", async () => {
  const harness = await createHarness();
  try {
    const { document, nav, window } = harness;
    const general = nav.querySelector('[data-settings-panel-slug="general-settings"]');
    const appearance = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const workflow = nav.querySelector('[data-settings-panel-slug="workflow"]');
    const voice = nav.querySelector('[data-settings-panel-slug="voice"]');
    assert.ok(workflow);

    appearance.focus();
    appearance.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(document.activeElement, workflow);
    assert.equal(workflow.getAttribute("aria-current"), "page");
    assert.equal(workflow.className, "nav active");
    assert.equal(general.className, "nav inactive");
    assert.ok(document.querySelector('[data-codex-workflow-panel="true"]'));

    workflow.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(document.activeElement, voice);
    assert.equal(voice.getAttribute("aria-current"), "page");
    assert.equal(document.querySelector('[data-codex-workflow-panel="true"]'), null);
    assert.equal(document.querySelector("#native-panel").style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("Focused Interface exposes a native customize disclosure with unique switches", async () => {
  const harness = await createHarness();
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();

    assert.equal(
      document.querySelector("#codex-workflow-focusedInterface-label").textContent,
      "Focused Interface",
    );
    assert.equal(
      document.querySelector("#codex-workflow-focusedInterface-description").textContent,
      "Hide optional Codex features and destinations to keep the interface focused on your workflow.",
    );

    const customize = document.querySelector('button[aria-controls="codex-workflow-focused-options"]');
    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    assert.equal(customize.parentElement, master.parentElement);
    assert.equal(customize.nextElementSibling, master);
    const options = document.querySelector("#codex-workflow-focused-options");
    assert.equal(customize.getAttribute("aria-expanded"), "false");
    assert.equal(options.hidden, true);

    customize.click();
    assert.equal(customize.getAttribute("aria-expanded"), "true");
    assert.equal(options.hidden, false);
    assert.equal(document.querySelector("#codex-workflow-hidePullRequests-label").textContent, "Hide Pull requests");
    assert.equal(document.querySelector("#codex-workflow-hidePetMenuItem-label").textContent, "Hide pet controls");
    assert.equal(document.querySelector("#codex-workflow-hideInviteFriendMenuItem-label").textContent, "Hide friend invite");
    assert.equal(document.querySelector("#codex-workflow-replaceHelpWithSettings-label").textContent, "Replace Help with Settings");
    assert.equal(document.querySelector("#codex-workflow-hideComposerMicrophone-label").textContent, "Hide microphone button");
    assert.equal(
      document.querySelector("#codex-workflow-hideComposerMicrophone-description").textContent,
      "Remove the Dictate button from the composer.",
    );
    const interfaceCard = document.querySelector("#codex-workflow-focusedInterface-label")
      .closest("section").querySelector("[role='switch']").parentElement.parentElement.parentElement;
    const microphoneToggle = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    assert.equal(interfaceCard.contains(microphoneToggle), true);
    assert.equal(options.contains(microphoneToggle), false);

    const switches = Array.from(document.querySelectorAll('[role="switch"]'));
    assert.equal(switches.length, 6);
    assert.equal(new Set(switches.map((control) => control.getAttribute("aria-labelledby"))).size, 6);
    assert.equal(new Set(switches.map((control) => control.getAttribute("aria-describedby"))).size, 6);
  } finally {
    harness.dom.window.close();
  }
});

test("composer microphone preference hides only the idle button and restores it exactly", async () => {
  const harness = await createHarness({
    initialSettings: { hideComposerMicrophone: true },
  });
  try {
    const { document, emitMutation, nav, window } = harness;
    const dictate = document.querySelector("#composer-dictate");
    const actions = document.querySelector("#composer-actions");
    const originalActionsClass = actions.className;
    const modelSelector = document.querySelector("#model-reasoning-selector");
    const contextRing = document.querySelector("#context-window-ring");
    const submitSlot = document.querySelector("#composer-submit-slot");
    const outside = document.querySelector("#outside-dictate");

    assert.equal(dictate.style.getPropertyValue("display"), "none");
    assert.equal(dictate.style.getPropertyPriority("display"), "important");
    assert.equal(dictate.getAttribute("aria-hidden"), "true");
    assert.equal(dictate.getAttribute("tabindex"), "-1");
    assert.equal(dictate.dataset.codexWorkflowComposerMicrophoneHidden, "true");
    assert.equal(actions.className, originalActionsClass);
    assert.equal(actions.style.cssText, "");
    assert.equal(modelSelector.style.display, "");
    assert.equal(contextRing.style.display, "");
    assert.equal(submitSlot.style.display, "");
    assert.equal(outside.style.display, "");

    emitMutation(actions);
    emitMutation(actions);
    await flush();
    assert.equal(
      document.querySelectorAll('[data-codex-workflow-composer-microphone-hidden="true"]').length,
      1,
    );
    window.history.pushState({}, "", "#composer-route-change");
    assert.equal(dictate.style.getPropertyValue("display"), "none");

    dictate.setAttribute("aria-label", "Stop dictation");
    emitMutation(dictate);
    await flush();
    assert.equal(dictate.style.getPropertyValue("display"), "inline-flex");
    assert.equal(dictate.style.getPropertyPriority("display"), "important");
    assert.equal(dictate.getAttribute("aria-hidden"), "false");
    assert.equal(dictate.getAttribute("tabindex"), "4");

    dictate.setAttribute("aria-label", "Dictate");
    emitMutation(dictate);
    await flush();
    assert.equal(dictate.style.getPropertyValue("display"), "none");

    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const toggle = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    toggle.click();
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    assert.equal(dictate.style.getPropertyValue("display"), "inline-flex");
    assert.equal(dictate.style.getPropertyPriority("display"), "important");
    assert.equal(dictate.getAttribute("aria-hidden"), "false");
    assert.equal(dictate.getAttribute("tabindex"), "4");
    assert.equal(dictate.hasAttribute("data-codex-workflow-composer-microphone-hidden"), false);
    assert.equal(actions.className, originalActionsClass);
    assert.equal(modelSelector.parentElement.id, "composer-expanding-controls");
    assert.equal(contextRing.parentElement, actions);
    assert.equal(submitSlot.parentElement, actions);
  } finally {
    harness.dom.window.close();
  }
});

test("absent and ambiguous composer microphone targets are left untouched", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation, nav } = harness;
    const actions = document.querySelector("#composer-actions");
    const original = document.querySelector("#composer-dictate");
    original.remove();
    emitMutation(actions, { removedNodes: [original] });

    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const toggle = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    toggle.click();
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(document.querySelector("#outside-dictate").style.display, "");

    const first = document.createElement("button");
    first.id = "ambiguous-dictate-one";
    first.setAttribute("aria-label", "Dictate");
    const second = document.createElement("button");
    second.id = "ambiguous-dictate-two";
    second.setAttribute("aria-label", "Dictate");
    actions.prepend(first, second);
    emitMutation(actions, { addedNodes: [first, second] });
    await flush();
    assert.equal(first.style.display, "");
    assert.equal(second.style.display, "");
    assert.equal(actions.style.cssText, "");

    second.remove();
    emitMutation(actions, { removedNodes: [second] });
    await flush();
    assert.equal(first.style.getPropertyValue("display"), "none");
    assert.equal(document.querySelector("#context-window-ring").style.display, "");
    assert.equal(document.querySelector("#composer-submit-slot").style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("composer microphone preference follows composer root remounts", async () => {
  const harness = await createHarness({
    initialSettings: { hideComposerMicrophone: true },
  });
  try {
    const { document, emitMutation, observers } = harness;
    const oldRoot = document.querySelector("#primary-composer");
    const oldDictate = document.querySelector("#composer-dictate");
    const replacement = document.createElement("div");
    replacement.id = "replacement-composer";
    replacement.setAttribute("role", "presentation");
    replacement.dataset.composerLayout = "multiline";
    replacement.innerHTML = `
      <div data-composer-rows="inline">
        <div class="flex min-w-0 flex-1 justify-end"><button aria-label="Select model and reasoning"></button></div>
        <div class="flex shrink-0 items-center gap-2">
          <button id="remounted-dictate" aria-label="Dictate"></button>
          <div class="ms-2 flex items-center"><button id="remounted-submit" aria-label="Send"></button></div>
        </div>
      </div>
    `;
    oldRoot.replaceWith(replacement);
    emitMutation(document.body, { addedNodes: [replacement], removedNodes: [oldRoot] });
    await flush();

    const remounted = document.querySelector("#remounted-dictate");
    assert.equal(oldDictate.style.getPropertyValue("display"), "inline-flex");
    assert.equal(remounted.style.getPropertyValue("display"), "none");
    assert.equal(document.querySelector("#remounted-submit").style.display, "");
    assert.ok(!observers.some((observer) => observer.active && observer.target === oldRoot));
    assert.ok(observers.some((observer) => observer.active && observer.target === replacement && observer.options?.subtree));
  } finally {
    harness.dom.window.close();
  }
});

test("failed composer microphone persistence rolls back optimistic state and effect", async () => {
  let rejectWrite;
  let receivedPatch;
  const pendingWrite = new Promise((_resolve, reject) => {
    rejectWrite = reject;
  });
  const harness = await createHarness({
    setSettings: (patch) => {
      receivedPatch = patch;
      return pendingWrite;
    },
  });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const toggle = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    const dictate = document.querySelector("#composer-dictate");
    toggle.click();

    assert.deepEqual(JSON.parse(JSON.stringify(receivedPatch)), { hideComposerMicrophone: true });
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(toggle.disabled, true);
    assert.equal(dictate.style.getPropertyValue("display"), "none");

    rejectWrite(new Error("fixture write failed"));
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    assert.equal(toggle.disabled, false);
    assert.equal(dictate.style.getPropertyValue("display"), "inline-flex");
    assert.equal(dictate.getAttribute("aria-hidden"), "false");
    assert.equal(dictate.getAttribute("tabindex"), "4");
  } finally {
    harness.dom.window.close();
  }
});

test("composer microphone preference remains usable when Focused Interface is off", async () => {
  const harness = await createHarness({
    initialSettings: { focusedInterface: false, hideComposerMicrophone: true },
  });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    const microphone = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.equal(microphone.getAttribute("aria-checked"), "true");
    assert.equal(microphone.disabled, false);
    assert.equal(document.querySelector("#composer-dictate").style.getPropertyValue("display"), "none");
  } finally {
    harness.dom.window.close();
  }
});

test("renderer normalisation keeps the microphone visible for malformed settings", async () => {
  const harness = await createHarness({
    initialSettings: { hideComposerMicrophone: "yes" },
  });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const microphone = document.querySelector('[aria-labelledby="codex-workflow-hideComposerMicrophone-label"]');
    assert.equal(microphone.getAttribute("aria-checked"), "false");
    assert.equal(document.querySelector("#composer-dictate").style.getPropertyValue("display"), "inline-flex");
  } finally {
    harness.dom.window.close();
  }
});

test("legacy Efficiency mode state migrates to Focused Interface", async () => {
  const harness = await createHarness({
    initialSettings: { schemaVersion: 1, efficiencyMode: false },
  });
  try {
    const { document, nav } = harness;
    assert.equal(document.querySelector("#pull-requests").style.getPropertyValue("display"), "block");
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();

    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    const pullRequests = document.querySelector('[aria-labelledby="codex-workflow-hidePullRequests-label"]');
    const petControls = document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]');
    const friendInvite = document.querySelector('[aria-labelledby="codex-workflow-hideInviteFriendMenuItem-label"]');
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.equal(pullRequests.getAttribute("aria-checked"), "true");
    assert.equal(petControls.getAttribute("aria-checked"), "true");
    assert.equal(friendInvite.getAttribute("aria-checked"), "true");
    assert.equal(pullRequests.disabled, true);
    assert.equal(petControls.disabled, true);
    assert.equal(friendInvite.disabled, true);
  } finally {
    harness.dom.window.close();
  }
});

test("pet controls are hidden only in the account menu and restore exactly", async () => {
  const harness = await createHarness({
    initialSettings: {
      schemaVersion: 2,
      focusedInterface: true,
      hidePullRequests: true,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: false,
    },
  });
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div id="pet-menu-item" role="menuitem" style="display: flex !important" aria-hidden="false" tabindex="2"><svg aria-hidden="true"></svg><span>Show pet</span></div>
      <div role="menuitem"><svg aria-hidden="true"></svg><span>Settings</span><span>⌘,</span></div>
      <button role="menuitem">Log out</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const petMenuItem = document.querySelector("#pet-menu-item");
    const petToggle = document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]');
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.style.getPropertyPriority("display"), "important");
    assert.equal(petMenuItem.getAttribute("aria-hidden"), "true");
    assert.equal(petMenuItem.getAttribute("tabindex"), "-1");
    assert.equal(menu.querySelector('[role="menuitem"]:nth-child(2)').style.display, "");

    petToggle.click();
    await flush();
    assert.equal(petMenuItem.style.getPropertyValue("display"), "flex");
    assert.equal(petMenuItem.style.getPropertyPriority("display"), "important");
    assert.equal(petMenuItem.getAttribute("aria-hidden"), "false");
    assert.equal(petMenuItem.getAttribute("tabindex"), "2");
    assert.equal(petMenuItem.hasAttribute("data-codex-workflow-pet-menu-hidden"), false);

    petMenuItem.querySelector("span").textContent = "Hide pet";
    petToggle.click();
    await flush();
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.hasAttribute("data-codex-workflow-pet-menu-hidden"), true);
  } finally {
    harness.dom.window.close();
  }
});

test("friend invite is hidden before the account menu's first rendered frame and restores exactly", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div id="usage-menu-item" role="menuitem">Usage</div>
      <div id="invite-friend-menu-item" role="menuitem" style="display: flex !important" aria-hidden="false" tabindex="4"><svg aria-hidden="true"></svg><span>Invite a friend</span></div>
      <div role="menuitem"><svg aria-hidden="true"></svg><span>Settings</span><span>⌘,</span></div>
      <button role="menuitem">Log out</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });

    const inviteItem = document.querySelector("#invite-friend-menu-item");
    const inviteToggle = document.querySelector('[aria-labelledby="codex-workflow-hideInviteFriendMenuItem-label"]');
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.style.getPropertyPriority("display"), "important");
    assert.equal(inviteItem.getAttribute("aria-hidden"), "true");
    assert.equal(inviteItem.getAttribute("tabindex"), "-1");
    assert.equal(document.querySelector("#usage-menu-item").style.display, "");

    inviteToggle.click();
    await flush();
    assert.equal(inviteItem.style.getPropertyValue("display"), "flex");
    assert.equal(inviteItem.style.getPropertyPriority("display"), "important");
    assert.equal(inviteItem.getAttribute("aria-hidden"), "false");
    assert.equal(inviteItem.getAttribute("tabindex"), "4");
    assert.equal(inviteItem.hasAttribute("data-codex-workflow-invite-friend-menu-hidden"), false);

    inviteToggle.click();
    await flush();
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.hasAttribute("data-codex-workflow-invite-friend-menu-hidden"), true);
  } finally {
    harness.dom.window.close();
  }
});

test("account menu discovery starts before the native pointerdown opener", async () => {
  const harness = await createHarness();
  try {
    const { document, window, emitMutation } = harness;
    const trigger = document.querySelector("#account-menu-trigger");
    let menu;
    trigger.addEventListener("pointerdown", () => {
      menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `
        <button id="pointerdown-pet-menu-item" role="menuitem">Show pet</button>
        <button id="pointerdown-invite-menu-item" role="menuitem">Invite a friend</button>
        <button role="menuitem">Settings</button>
      `;
      document.body.appendChild(menu);
      emitMutation(document.body, { addedNodes: [menu] });
    });

    trigger.dispatchEvent(new window.MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
    }));

    assert.equal(menu.querySelector("#pointerdown-pet-menu-item").style.display, "none");
    assert.equal(menu.querySelector("#pointerdown-invite-menu-item").style.display, "none");
  } finally {
    harness.dom.window.close();
  }
});

test("account menu discovery handles labels populated after portal mount", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation } = harness;
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const petItem = document.createElement("button");
    petItem.id = "late-pet-menu-item";
    petItem.setAttribute("role", "menuitem");
    const petLabel = document.createTextNode("");
    petItem.appendChild(petLabel);
    const inviteItem = document.createElement("button");
    inviteItem.id = "late-invite-menu-item";
    inviteItem.setAttribute("role", "menuitem");
    const inviteLabel = document.createTextNode("");
    inviteItem.appendChild(inviteLabel);
    const settingsItem = document.createElement("button");
    settingsItem.setAttribute("role", "menuitem");
    const settingsLabel = document.createTextNode("");
    settingsItem.appendChild(settingsLabel);
    menu.append(petItem, inviteItem, settingsItem);
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();
    assert.equal(petItem.style.getPropertyValue("display"), "");
    assert.equal(inviteItem.style.getPropertyValue("display"), "");

    petLabel.nodeValue = "Show pet";
    inviteLabel.nodeValue = "Invite a friend";
    settingsLabel.nodeValue = "Settings";
    emitMutation(petLabel);
    emitMutation(inviteLabel);
    emitMutation(settingsLabel);
    await flush();
    assert.equal(petItem.style.getPropertyValue("display"), "none");
    assert.equal(petItem.getAttribute("aria-hidden"), "true");
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.getAttribute("aria-hidden"), "true");
  } finally {
    harness.dom.window.close();
  }
});

test("account menu items are hidden before the first paint after a deferred portal mount", async () => {
  const harness = await createHarness();
  try {
    const {
      document,
      window,
      emitMutation,
      deferAnimationFrames,
      flushAnimationFrame,
    } = harness;
    deferAnimationFrames();
    document.querySelector("#account-menu-trigger").click();

    let petItem;
    let inviteItem;
    window.requestAnimationFrame(() => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `
        <button id="deferred-pet-menu-item" role="menuitem">Show pet</button>
        <button id="deferred-invite-menu-item" role="menuitem">Invite a friend</button>
        <button role="menuitem">Settings</button>
      `;
      document.body.appendChild(menu);
      petItem = menu.querySelector("#deferred-pet-menu-item");
      inviteItem = menu.querySelector("#deferred-invite-menu-item");
      emitMutation(document.body, { addedNodes: [menu] });
    });

    flushAnimationFrame();
    await flush();
    assert.equal(petItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
  } finally {
    harness.dom.window.close();
  }
});

test("Help and Settings swap preserves native behavior, alignment, dismissal, and restoration", async () => {
  const harness = await createHarness();
  try {
    const { document, window, emitMutation, nav } = harness;
    const accountTrigger = document.querySelector("#account-menu-trigger");
    const shortcut = document.querySelector("#sidebar-help-trigger");
    let accountMenu = null;
    let helpMenu = null;
    let settingsOpenCount = 0;

    const unmountAccount = () => {
      if (!accountMenu) return;
      const removed = accountMenu;
      accountMenu = null;
      removed.remove();
      emitMutation(document.body, { removedNodes: [removed] });
    };
    const unmountHelp = () => {
      if (!helpMenu) return;
      const removed = helpMenu;
      helpMenu = null;
      removed.remove();
      emitMutation(document.body, { removedNodes: [removed] });
    };
    const mountAccount = () => {
      accountMenu = document.createElement("div");
      accountMenu.id = "native-account-menu";
      accountMenu.setAttribute("role", "menu");
      accountMenu.innerHTML = `
        <button id="native-settings-item" role="menuitem">
          <svg class="icon-xs" viewBox="0 0 20 20"><path d="native-settings"></path></svg>
          <span>Settings</span><span id="native-settings-shortcut">⌘,</span>
        </button>
        <button role="menuitem">Log out</button>
      `;
      accountMenu.getBoundingClientRect = () => ({
        width: 260, height: 300, left: 24, right: 284, top: 400, bottom: 700,
      });
      accountMenu.querySelector("#native-settings-item").addEventListener("click", () => {
        settingsOpenCount += 1;
        unmountAccount();
      });
      document.body.appendChild(accountMenu);
      emitMutation(document.body, { addedNodes: [accountMenu] });
    };
    const mountHelp = () => {
      helpMenu = document.createElement("div");
      helpMenu.id = "native-help-menu";
      helpMenu.setAttribute("role", "menu");
      helpMenu.innerHTML = `
        <div>What’s new</div>
        <div role="separator"></div>
        <button role="menuitem"><svg class="icon-xs"></svg><span>Set up Chrome extension</span></button>
        <button role="menuitem"><svg class="icon-xs"></svg><span>Keyboard shortcuts</span></button>
        <button role="menuitem"><svg class="icon-xs"></svg><span>Help</span></button>
      `;
      helpMenu.getBoundingClientRect = () => {
        const values = helpMenu.style.translate.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) || [];
        const x = values[0] || 0;
        const y = values[1] || 0;
        return {
          width: 320, height: 300, left: 56 + x, right: 376 + x,
          top: 320 + y, bottom: 620 + y,
        };
      };
      document.body.appendChild(helpMenu);
      emitMutation(document.body, { addedNodes: [helpMenu] });
    };
    accountTrigger.addEventListener("click", () => {
      if (accountMenu) unmountAccount();
      else mountAccount();
    });
    accountTrigger.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown") return;
      if (accountMenu) unmountAccount();
      else mountAccount();
    });
    shortcut.addEventListener("click", () => {
      if (helpMenu) unmountHelp();
      else mountHelp();
    });
    shortcut.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown") return;
      if (helpMenu) unmountHelp();
      else mountHelp();
    });
    document.addEventListener("pointerdown", (event) => {
      if (helpMenu && !helpMenu.contains(event.target) && event.target !== shortcut) unmountHelp();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") unmountHelp();
      if (event.key === "Escape" && accountMenu) unmountAccount();
      if (event.metaKey && event.key === ",") {
        settingsOpenCount += 1;
        unmountAccount();
      }
    });

    assert.equal(shortcut.getAttribute("aria-label"), "Open settings");
    assert.equal(shortcut.className, "size-8 shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0");
    assert.equal(shortcut.querySelector("svg").className.baseVal, "icon-sm");
    assert.equal(shortcut.querySelectorAll("svg path").length, 2);
    const firstGearPath = shortcut.querySelector("svg path");
    emitMutation(shortcut);
    await flush();
    assert.equal(shortcut.querySelector("svg path"), firstGearPath);

    shortcut.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    shortcut.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    await flush();
    assert.equal(settingsOpenCount, 1);
    assert.equal(accountMenu, null);
    assert.equal(helpMenu, null);
    assert.equal(harness.invokedChannels.filter((channel) =>
      channel === "codex-workflow:settings:activate").length, 1);

    accountTrigger.click();
    const helpUpdates = accountMenu.querySelector('[data-codex-workflow-help-updates="true"]');
    assert.ok(helpUpdates);
    assert.equal(helpUpdates.getAttribute("aria-label"), "Help & Updates");
    assert.equal(helpUpdates.textContent.includes("Settings"), false);
    assert.equal(helpUpdates.textContent.includes("Help & Updates"), true);
    assert.equal(helpUpdates.querySelectorAll("svg path").length, 2);
    assert.ok(Array.from(helpUpdates.querySelectorAll("*")).some((element) =>
      element.style.getPropertyValue("display") === "none" && element.getAttribute("aria-hidden") === "true"));

    helpUpdates.click();
    await flush();
    assert.equal(accountMenu, null);
    assert.ok(helpMenu);
    assert.equal(helpMenu.getBoundingClientRect().left, 24);
    assert.equal(helpMenu.getBoundingClientRect().bottom, 700);
    const back = helpMenu.querySelector('[data-codex-workflow-help-back="true"]');
    assert.ok(back);
    assert.equal(back.getAttribute("aria-label"), "Back");
    assert.equal(back.querySelector("svg").className.baseVal, "icon-xs");
    assert.equal(helpMenu.querySelectorAll('[data-codex-workflow-help-back="true"]').length, 1);

    back.click();
    await flush();
    assert.equal(helpMenu, null);
    assert.equal(accountMenu, null);

    accountTrigger.click();
    accountMenu.querySelector('[data-codex-workflow-help-updates="true"]').click();
    await flush();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(helpMenu, null);

    accountTrigger.click();
    accountMenu.querySelector('[data-codex-workflow-help-updates="true"]').click();
    await flush();
    document.body.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    assert.equal(helpMenu, null);

    accountTrigger.click();
    accountMenu.querySelector('[data-codex-workflow-help-updates="true"]').click();
    await flush();
    accountTrigger.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    accountTrigger.click();
    assert.equal(helpMenu, null);
    assert.ok(accountMenu);
    assert.ok(accountMenu.querySelector('[data-codex-workflow-help-updates="true"]'));

    shortcut.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    shortcut.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    await flush();
    assert.equal(settingsOpenCount, 2);
    assert.equal(accountMenu, null);

    shortcut.focus();
    shortcut.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    shortcut.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 0 }));
    await flush();
    assert.equal(settingsOpenCount, 3);
    assert.equal(accountMenu, null);

    accountTrigger.click();
    assert.ok(accountMenu.querySelector('[data-codex-workflow-help-updates="true"]'));

    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector('[aria-labelledby="codex-workflow-replaceHelpWithSettings-label"]').click();
    await flush();
    assert.equal(shortcut.getAttribute("aria-label"), "Open help menu");
    assert.equal(shortcut.querySelector("path").getAttribute("d"), "native-question");
    assert.equal(accountMenu.querySelector("#native-settings-item").textContent.includes("Settings"), true);
    assert.equal(accountMenu.querySelector("#native-settings-shortcut").style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("account-menu remounts cannot reintroduce Settings before paint", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation } = harness;
    document.querySelector("#account-menu-trigger").click();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="remounted-settings" role="menuitem">
        <svg class="icon-xs"><path d="native-settings"></path></svg>
        <span>Settings</span><span>⌘,</span>
      </button>
      <button role="menuitem">Show pet</button>
      <button role="menuitem">Invite a friend</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });

    const item = menu.querySelector("#remounted-settings");
    let helpUpdates = menu.querySelector('[data-codex-workflow-help-updates="true"]');
    assert.equal(item.style.getPropertyValue("display"), "none");
    assert.equal(helpUpdates.textContent.includes("Settings"), false);
    assert.equal(helpUpdates.textContent.includes("Help & Updates"), true);

    const replacement = document.createElement("button");
    replacement.id = "remounted-settings-replacement";
    replacement.setAttribute("role", "menuitem");
    replacement.innerHTML = `
      <svg class="icon-xs"><path d="native-settings-remount"></path></svg>
      <span>Settings</span><span>⌘,</span>
    `;
    item.replaceWith(replacement);
    emitMutation(menu, { addedNodes: [replacement], removedNodes: [item] });
    helpUpdates = menu.querySelector('[data-codex-workflow-help-updates="true"]');
    assert.equal(item.isConnected, false);
    assert.equal(replacement.style.getPropertyValue("display"), "none");
    assert.equal(helpUpdates.textContent.includes("Settings"), false);
    assert.equal(helpUpdates.textContent.includes("Help & Updates"), true);
    assert.equal(menu.querySelectorAll('[data-codex-workflow-help-updates="true"]').length, 1);
  } finally {
    harness.dom.window.close();
  }
});

test("Focused Interface controls all configured interface effects", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="pet-menu-item" role="menuitem">Show pet</button>
      <button id="invite-friend-menu-item" role="menuitem">Invite a friend</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    const childToggles = [
      document.querySelector('[aria-labelledby="codex-workflow-hidePullRequests-label"]'),
      document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]'),
      document.querySelector('[aria-labelledby="codex-workflow-hideInviteFriendMenuItem-label"]'),
    ];
    const pullRequests = document.querySelector("#pull-requests");
    const petMenuItem = document.querySelector("#pet-menu-item");
    const inviteItem = document.querySelector("#invite-friend-menu-item");
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");

    master.click();
    await flush();
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.ok(childToggles.every((toggle) => toggle.disabled));
    assert.equal(pullRequests.style.getPropertyValue("display"), "block");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "");
    assert.equal(inviteItem.style.getPropertyValue("display"), "");

    master.click();
    await flush();
    assert.equal(master.getAttribute("aria-checked"), "true");
    assert.ok(childToggles.every((toggle) => !toggle.disabled));
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
  } finally {
    harness.dom.window.close();
  }
});

test("ambiguous pet menu targets are left untouched", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation } = harness;
    document.querySelector("#account-menu-trigger").click();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button role="menuitem">Show pet</button>
      <button role="menuitem">Hide pet</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();
    const petItems = menu.querySelectorAll('[role="menuitem"]');
    assert.equal(petItems[0].style.display, "");
    assert.equal(petItems[1].style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("ambiguous friend invite targets are left untouched", async () => {
  const harness = await createHarness();
  try {
    const { document, emitMutation } = harness;
    document.querySelector("#account-menu-trigger").click();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button role="menuitem">Invite a friend</button>
      <button role="menuitem" aria-label="Invite a friend">Invite</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();
    const inviteItems = menu.querySelectorAll('[role="menuitem"]');
    assert.equal(inviteItems[0].style.display, "");
    assert.equal(inviteItems[1].style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("failed pet preference persistence restores its switch and menu effect", async () => {
  const harness = await createHarness({
    setSettings: () => Promise.reject(new Error("fixture write failed")),
  });
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="pet-menu-item" role="menuitem">Show pet</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const petMenuItem = document.querySelector("#pet-menu-item");
    const petToggle = document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]');
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    petToggle.click();
    await flush();
    assert.equal(petToggle.getAttribute("aria-checked"), "true");
    assert.equal(petToggle.disabled, false);
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.getAttribute("aria-hidden"), "true");
  } finally {
    harness.dom.window.close();
  }
});

test("failed friend invite preference persistence restores its switch and menu effect", async () => {
  const harness = await createHarness({
    setSettings: () => Promise.reject(new Error("fixture write failed")),
  });
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="invite-friend-menu-item" role="menuitem">Invite a friend</button>
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const inviteItem = document.querySelector("#invite-friend-menu-item");
    const inviteToggle = document.querySelector('[aria-labelledby="codex-workflow-hideInviteFriendMenuItem-label"]');
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    inviteToggle.click();
    await flush();
    assert.equal(inviteToggle.getAttribute("aria-checked"), "true");
    assert.equal(inviteToggle.disabled, false);
    assert.equal(inviteItem.style.getPropertyValue("display"), "none");
    assert.equal(inviteItem.getAttribute("aria-hidden"), "true");
  } finally {
    harness.dom.window.close();
  }
});

test("failed Help and Settings preference persistence restores both native surfaces", async () => {
  const harness = await createHarness({
    setSettings: () => Promise.reject(new Error("fixture write failed")),
  });
  try {
    const { document, emitMutation, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    document.querySelector('button[aria-controls="codex-workflow-focused-options"]').click();
    document.querySelector("#account-menu-trigger").click();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button id="rollback-settings-item" role="menuitem">
        <svg class="icon-xs"><path d="native-settings"></path></svg>
        <span>Settings</span><span>⌘,</span>
      </button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });

    const toggle = document.querySelector('[aria-labelledby="codex-workflow-replaceHelpWithSettings-label"]');
    const shortcut = document.querySelector("#sidebar-help-trigger");
    assert.equal(shortcut.getAttribute("aria-label"), "Open settings");
    assert.ok(menu.querySelector('[data-codex-workflow-help-updates="true"]'));

    toggle.click();
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(toggle.disabled, false);
    assert.equal(shortcut.getAttribute("aria-label"), "Open settings");
    const restoredHelp = menu.querySelector('[data-codex-workflow-help-updates="true"]');
    assert.ok(restoredHelp);
    assert.equal(restoredHelp.textContent.includes("Settings"), false);
    assert.equal(menu.querySelector("#rollback-settings-item").style.getPropertyValue("display"), "none");
  } finally {
    harness.dom.window.close();
  }
});

test("failed settings persistence rolls the switch and sidebar effect back", async () => {
  const harness = await createHarness({
    setSettings: () => Promise.reject(new Error("fixture write failed")),
  });
  try {
    const { document, nav } = harness;
    nav.querySelector('[data-settings-panel-slug="workflow"]').click();
    const toggle = document.querySelector('[role="switch"]');
    const pullRequests = document.querySelector("#pull-requests");
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");

    toggle.click();
    await flush();
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(toggle.disabled, false);
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");
    assert.equal(pullRequests.style.getPropertyPriority("display"), "important");
    assert.equal(pullRequests.getAttribute("aria-hidden"), "true");
    assert.equal(pullRequests.getAttribute("tabindex"), "-1");
  } finally {
    harness.dom.window.close();
  }
});

test("route and native settings changes restore the original view", async () => {
  const harness = await createHarness();
  try {
    const { document, nav, window } = harness;
    const workflow = nav.querySelector('[data-settings-panel-slug="workflow"]');
    workflow.click();
    window.history.pushState({}, "", "#projects");
    assert.equal(document.querySelector('[data-codex-workflow-panel="true"]'), null);
    assert.equal(document.querySelector("#native-panel").style.display, "");

    workflow.click();
    nav.querySelector('[data-settings-panel-slug="general-settings"]').removeAttribute("aria-current");
    nav.querySelector('[data-settings-panel-slug="appearance"]').setAttribute("aria-current", "page");
    window.history.replaceState({}, "", "#projects");
    assert.equal(document.querySelector('[data-codex-workflow-panel="true"]'), null);
    assert.equal(document.querySelector("#native-panel").style.display, "");
  } finally {
    harness.dom.window.close();
  }
});

test("root discovery remains active through a slow Codex route mount", async () => {
  const harness = await createHarness({ delayedRoots: true });
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assert.equal(harness.runNextTimeout(), true);
    }
    assert.equal(harness.runNextTimeout(), false);
    assert.ok(harness.observers.some((observer) =>
      observer.active && observer.target === harness.document.documentElement));
    harness.mountDelayedRoots();
    await flush();
    assert.equal(harness.document.querySelector("#pull-requests").style.getPropertyValue("display"), "none");
    assert.equal(harness.document.querySelector("#sidebar-help-trigger").getAttribute("aria-label"), "Open settings");
    assert.ok(harness.nav.querySelector('[data-settings-panel-slug="workflow"]'));
  } finally {
    harness.dom.window.close();
  }
});

test("scoped observers ignore 120 response-stream mutations", async () => {
  const harness = await createHarness();
  try {
    const { document, observers, intervalCalls, emitMutation, deliveredMutationCallbacks } = harness;
    const sidebar = document.querySelector(".app-shell-left-panel");
    const settingsShell = document.querySelector("#settings-shell");
    const composer = document.querySelector("#primary-composer");
    const activeSubtreeTargets = observers
      .filter((observer) => observer.active && observer.options?.subtree)
      .map((observer) => observer.target);

    assert.equal(intervalCalls.length, 0);
    assert.deepEqual(new Set(activeSubtreeTargets), new Set([sidebar, settingsShell, composer]));
    assert.ok(!activeSubtreeTargets.includes(document.documentElement));

    const beforeCallbacks = deliveredMutationCallbacks();
    const responseStream = document.querySelector("#response-stream");
    for (let index = 0; index < 120; index += 1) {
      const streamed = document.createElement("p");
      responseStream.appendChild(streamed);
      emitMutation(responseStream, { addedNodes: [streamed] });
    }
    await flush();
    assert.equal(deliveredMutationCallbacks(), beforeCallbacks);

    const remountedRow = document.createElement("div");
    remountedRow.className = "sidebar-item";
    remountedRow.innerHTML = '<a href="/pull-requests"><span class="text-fade-truncate">Pull requests</span></a>';
    sidebar.appendChild(remountedRow);
    emitMutation(sidebar, { addedNodes: [remountedRow] });
    await flush();
    assert.equal(remountedRow.style.getPropertyValue("display"), "none");
    assert.equal(deliveredMutationCallbacks(), beforeCallbacks + 1);
  } finally {
    harness.dom.window.close();
  }
});

test("scoped roots rebind after sidebar and settings remounts", async () => {
  const harness = await createHarness();
  try {
    const { document, observers, emitMutation } = harness;
    const oldSidebar = document.querySelector(".app-shell-left-panel");
    const newSidebar = document.createElement("aside");
    newSidebar.className = "app-shell-left-panel";
    newSidebar.innerHTML = '<div class="sidebar-item"><a href="/pull-requests"><span class="text-fade-truncate">Pull requests</span></a></div>';
    oldSidebar.replaceWith(newSidebar);
    emitMutation(document.body, { addedNodes: [newSidebar], removedNodes: [oldSidebar] });
    await flush();
    assert.equal(
      newSidebar.querySelector(".sidebar-item").style.getPropertyValue("display"),
      "none",
    );
    assert.ok(!observers.some((observer) => observer.active && observer.target === oldSidebar));

    const oldShell = document.querySelector("#settings-shell");
    const newShell = oldShell.cloneNode(true);
    newShell.querySelectorAll("[data-codex-workflow], [data-codex-workflow-panel]")
      .forEach((element) => element.remove());
    oldShell.replaceWith(newShell);
    emitMutation(document.body, { addedNodes: [newShell], removedNodes: [oldShell] });
    await flush();
    assert.equal(newShell.querySelectorAll('[data-settings-panel-slug="workflow"]').length, 1);
    assert.ok(!observers.some((observer) => observer.active && observer.target === oldShell));
  } finally {
    harness.dom.window.close();
  }
});
