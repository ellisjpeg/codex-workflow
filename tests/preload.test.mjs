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

async function createHarness({ initialSettings, installUpdateResult, setSettings, updateStatus, delayedRoots = false } = {}) {
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
    };
  const ipcRenderer = {
    invoke(channel, patch) {
      invokedChannels.push(channel);
      if (channel === "codex-workflow:settings:get") {
        return Promise.resolve({ ...persistedSettings });
      }
      if (channel === "codex-workflow:update:get") {
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
      observers.push(this);
    }

    observe(target, options) {
      this.active = true;
      this.target = target;
      this.options = options;
    }

    disconnect() {
      this.active = false;
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
    titlebar.innerHTML = `
      <div id="sidebar-titlebar-region">
        <div id="sidebar-titlebar-controls" class="inline-flex h-full items-center pointer-events-none w-full">
          <button aria-label="Hide sidebar"></button>
          <button aria-label="Back"></button>
          <button aria-label="Forward"></button>
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
    const nativeControls = Array.from(controls.children);
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

    const switches = Array.from(document.querySelectorAll('[role="switch"]'));
    assert.equal(switches.length, 5);
    assert.equal(new Set(switches.map((control) => control.getAttribute("aria-labelledby"))).size, 5);
    assert.equal(new Set(switches.map((control) => control.getAttribute("aria-describedby"))).size, 5);
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
    const activeSubtreeTargets = observers
      .filter((observer) => observer.active && observer.options?.subtree)
      .map((observer) => observer.target);

    assert.equal(intervalCalls.length, 0);
    assert.deepEqual(new Set(activeSubtreeTargets), new Set([sidebar, settingsShell]));
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
