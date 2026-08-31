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

async function createHarness({ initialSettings, setSettings } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <aside class="app-shell-left-panel">
      <div id="pull-requests" class="sidebar-item" style="display: block !important" aria-hidden="false" tabindex="3">
        <a href="/pull-requests"><span class="text-fade-truncate">Pull requests</span></a>
      </div>
      <button id="account-menu-trigger" type="button">Account</button>
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
  const observers = [];
  const intervalCalls = [];
  const timeoutCallbacks = new Map();
  let nextTimer = 1;
  let deliveredMutationCallbacks = 0;
  let persistedSettings = initialSettings
    ? { ...initialSettings }
    : {
      schemaVersion: 2,
      focusedInterface: true,
      hidePullRequests: true,
      hidePetMenuItem: true,
    };
  const ipcRenderer = {
    invoke(channel, patch) {
      if (channel === "codex-workflow:settings:get") {
        return Promise.resolve({ ...persistedSettings });
      }
      if (setSettings) return setSettings(patch);
      persistedSettings = { ...persistedSettings, ...patch, schemaVersion: 2 };
      return Promise.resolve({ ...persistedSettings });
    },
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
    callback();
    return 1;
  };
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });

  const nav = document.querySelector("nav");
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
    observers,
    intervalCalls,
    timeoutCallbacks,
    emitMutation,
    deliveredMutationCallbacks: () => deliveredMutationCallbacks,
  };
}

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

    const switches = Array.from(document.querySelectorAll('[role="switch"]'));
    assert.equal(switches.length, 3);
    assert.equal(new Set(switches.map((control) => control.getAttribute("aria-labelledby"))).size, 3);
    assert.equal(new Set(switches.map((control) => control.getAttribute("aria-describedby"))).size, 3);
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
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.equal(pullRequests.getAttribute("aria-checked"), "true");
    assert.equal(petControls.getAttribute("aria-checked"), "true");
    assert.equal(pullRequests.disabled, true);
    assert.equal(petControls.disabled, true);
  } finally {
    harness.dom.window.close();
  }
});

test("pet controls are hidden only in the account menu and restore exactly", async () => {
  const harness = await createHarness();
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

test("pet menu discovery handles labels populated after portal mount", async () => {
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
    const settingsItem = document.createElement("button");
    settingsItem.setAttribute("role", "menuitem");
    const settingsLabel = document.createTextNode("");
    settingsItem.appendChild(settingsLabel);
    menu.append(petItem, settingsItem);
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();
    assert.equal(petItem.style.getPropertyValue("display"), "");

    petLabel.nodeValue = "Show pet";
    settingsLabel.nodeValue = "Settings";
    emitMutation(petLabel);
    emitMutation(settingsLabel);
    await flush();
    assert.equal(petItem.style.getPropertyValue("display"), "none");
    assert.equal(petItem.getAttribute("aria-hidden"), "true");
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
      <button role="menuitem">Settings</button>
    `;
    document.body.appendChild(menu);
    emitMutation(document.body, { addedNodes: [menu] });
    await flush();

    const master = document.querySelector('[aria-labelledby="codex-workflow-focusedInterface-label"]');
    const childToggles = [
      document.querySelector('[aria-labelledby="codex-workflow-hidePullRequests-label"]'),
      document.querySelector('[aria-labelledby="codex-workflow-hidePetMenuItem-label"]'),
    ];
    const pullRequests = document.querySelector("#pull-requests");
    const petMenuItem = document.querySelector("#pet-menu-item");
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");

    master.click();
    await flush();
    assert.equal(master.getAttribute("aria-checked"), "false");
    assert.ok(childToggles.every((toggle) => toggle.disabled));
    assert.equal(pullRequests.style.getPropertyValue("display"), "block");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "");

    master.click();
    await flush();
    assert.equal(master.getAttribute("aria-checked"), "true");
    assert.ok(childToggles.every((toggle) => !toggle.disabled));
    assert.equal(pullRequests.style.getPropertyValue("display"), "none");
    assert.equal(petMenuItem.style.getPropertyValue("display"), "none");
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
