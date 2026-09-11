"use strict";

const { ipcRenderer, webFrame } = require("electron");

function selectUsageWindow(value, now = Date.now()) {
  if (value?.unavailable || !Array.isArray(value?.windows)) return null;
  const windows = value.windows.filter((window) =>
    Number.isFinite(window?.usedPercent) && Number.isFinite(window?.windowDurationMins) &&
    window.windowDurationMins > 0 &&
    (window.resetsAt == null || Number.isFinite(window.resetsAt)))
    .sort((left, right) => left.windowDurationMins - right.windowDurationMins);
  const selected = windows.find((window) => window.usedPercent >= 100) || windows[0];
  if (!selected || selected.resetsAt != null && selected.resetsAt * 1000 <= now) return null;
  const minutes = selected.windowDurationMins;
  const near = (duration) => Math.abs(minutes - duration) <= duration * 0.05;
  return {
    remaining: value.blocked ? 0 : Math.round(Math.max(0, Math.min(100, 100 - selected.usedPercent))),
    label: near(300) ? "5hr limit" : near(10080) ? "Weekly limit" : minutes >= 28 * 1440 && minutes <= 31 * 1440 ? "Monthly limit" : "Usage limit",
  };
}

async function installNativeUsageBridge(enabled) {
  const key = "__codexWorkflowNativeUsageBridge";
  if (new URL(window.location.href).searchParams.get("initialRoute") === "/avatar-overlay") {
    window[key]?.stop();
    return;
  }
  const previous = window[key];
  if (previous) {
    if (enabled === true) previous.replay();
    else previous.stop();
    return;
  }
  const empty = { windows: [], blocked: false, unavailable: true };
  const emit = (value) => window.dispatchEvent(new CustomEvent("codex-workflow:usage", {
    detail: JSON.stringify(value),
  }));
  if (enabled !== true) { emit(empty); return; }
  let active = true;
  let native;
  let client;
  let unsubscribeCache;
  const disposers = [];
  let epoch = 0;
  let connected = true;
  let authenticated = true;
  let needsFresh = false;
  let pending = null;
  let queued = false;
  let resetTimer = null;
  let expiredResetAt = null;
  let lastRaw;
  let lastUpdatedAt;
  let accountId = null;
  let coreName = null;
  let slots = [null, null];
  let coreBlocked = false;
  let published = empty;
  const filter = { queryKey: ["rate-limit-status"], exact: true };
  const owner = {
    replay() { emit(published); },
    stop() {
      if (window[key] === owner) delete window[key];
      if (!active) return;
      active = false;
      epoch += 1;
      clearTimeout(resetTimer);
      unsubscribeCache?.();
      for (const dispose of disposers) dispose();
      emit(empty);
    },
  };
  window[key] = owner;

  function publish(value) {
    if (!active) return;
    clearTimeout(resetTimer);
    resetTimer = null;
    published = value;
    emit(value);
  }
  function windowValue(value, base) {
    const duration = value?.windowDurationMins ?? base?.windowDurationMins;
    if (!Number.isFinite(value?.usedPercent) || !Number.isFinite(duration) || duration <= 0) return null;
    const reset = value.resetsAt ?? base?.resetsAt;
    return {
      usedPercent: Math.min(100, Math.max(0, value.usedPercent)),
      windowDurationMins: duration,
      resetsAt: Number.isFinite(reset) && reset >= 0 ? reset : null,
    };
  }
  function publishWindows() {
    const windows = slots.filter(Boolean);
    const resets = windows.map((value) => value.resetsAt == null ? NaN : value.resetsAt * 1000).filter(Number.isFinite);
    const deadline = resets.length ? Math.min(...resets) : null;
    const expired = deadline != null && deadline <= Date.now();
    publish(expired ? empty : { windows, blocked: coreBlocked || windows.some((value) => value.usedPercent >= 100), unavailable: windows.length === 0 });
    if (deadline == null || (expired && deadline === expiredResetAt)) return;
    function arm() {
      // Browser timers cap delays at ~24.8 days; a monthly window may need
      // one remaining-delay handoff, never an early refresh or an interval.
      resetTimer = setTimeout(() => {
        resetTimer = null;
        if (!active) return;
        if (Date.now() < deadline) { arm(); return; }
        expiredResetAt = deadline;
        reset();
        refresh(true);
      }, Math.min(2147483647, Math.max(0, deadline - Date.now())));
    }
    arm();
  }
  function readCache(fresh = false) {
    if (!active || !connected || !authenticated || (needsFresh && !fresh)) return;
    const state = client?.getQueryState(filter.queryKey);
    const raw = state?.data;
    if (state?.status !== "success" || !raw || typeof raw !== "object") {
      slots = [null, null];
      accountId = null;
      lastRaw = undefined;
      publish(empty);
      return;
    }
    // fetchQuery can resolve immediately from still-fresh native cache.
    // That is not a newer snapshot than an already merged sparse update.
    if (raw === lastRaw && state.dataUpdatedAt === lastUpdatedAt) return;
    if (!fresh && accountId && raw.account_id !== accountId) {
      reset();
      refresh(true);
      return;
    }
    lastRaw = raw;
    lastUpdatedAt = state.dataUpdatedAt;
    accountId = typeof raw.account_id === "string" ? raw.account_id : null;
    coreName = typeof raw.rate_limit_name === "string" ? raw.rate_limit_name : null;
    slots = [raw.rate_limit?.primary_window, raw.rate_limit?.secondary_window].map((value) => windowValue({
      usedPercent: value?.used_percent,
      windowDurationMins: typeof value?.limit_window_seconds === "number" ? value.limit_window_seconds / 60 : null,
      resetsAt: value?.reset_at,
    }));
    coreBlocked = raw.rate_limit?.allowed === false || raw.rate_limit?.limit_reached === true;
    publishWindows();
  }
  function bindClient() {
    const scope = native?.$f();
    const next = scope?.queryClient;
    if (!next || next === client) return scope;
    unsubscribeCache?.();
    if (client) reset();
    client = next;
    lastRaw = undefined;
    unsubscribeCache = client.getQueryCache().subscribe((event) => {
      const queryKey = event.query?.queryKey;
      if (queryKey?.length === 1 && queryKey[0] === filter.queryKey[0]) readCache();
    });
    readCache();
    return scope;
  }
  function refresh(force = false) {
    if (!active || !connected || !authenticated) return;
    let scope;
    try { scope = bindClient(); } catch { publish(empty); return; }
    if (!scope) { publish(empty); return; }
    if (pending) { queued ||= force || needsFresh; return; }
    const requestEpoch = epoch;
    const requestClient = client;
    pending = Promise.resolve().then(async () => {
      if (!active || requestEpoch !== epoch) return;
      if (needsFresh) await requestClient.cancelQueries(filter);
      if (!active || requestEpoch !== epoch) return;
      const options = scope.query.getOptions(native.sAt);
      await requestClient.fetchQuery({ ...options, ...((force || needsFresh) ? { staleTime: 0 } : {}) });
      if (active && requestEpoch === epoch && requestClient === client) {
        needsFresh = false;
        readCache(true);
      }
    }).catch(() => {
      if (active && requestEpoch === epoch) {
        needsFresh = true;
        accountId = null;
        slots = [null, null];
        lastRaw = undefined;
        publish(empty);
      }
    }).finally(() => {
      pending = null;
      if (queued) { queued = false; refresh(true); }
    });
  }
  function reset() {
    epoch += 1;
    needsFresh = true;
    slots = [null, null];
    accountId = null;
    coreName = null;
    lastRaw = undefined;
    coreBlocked = false;
    publish(empty);
    // Cancel this one native query so a request from the old account cannot
    // satisfy the next account's forced fetch through query deduplication.
    const cancelledClient = client;
    Promise.resolve().then(() => cancelledClient?.cancelQueries(filter)).catch(() => {});
  }
  function notification(message) {
    if (message.hostId !== "local") return;
    if (message.method === "account/updated") {
      const mode = message.params?.authMode;
      authenticated = mode === undefined || mode === "chatgpt" || mode === "chatgptAuthTokens";
      reset();
      refresh(true);
    } else if (message.method === "account/rateLimits/updated") {
      const update = message.params?.rateLimits;
      const matchesCore = update?.limitId === "codex" &&
        (update.limitName == null || update.limitName === "codex" || update.limitName === coreName);
      if (connected && authenticated && !needsFresh && accountId && matchesCore) {
        for (const [index, name] of ["primary", "secondary"].entries()) {
          if (update[name] != null) slots[index] = windowValue(update[name], slots[index]) ?? slots[index];
        }
        publishWindows();
      }
      refresh();
    }
  }
  function connection(message) {
    if (message.hostId !== "local") return;
    connected = message.state === "connected";
    reset();
    if (connected) refresh(true);
  }
  function focus() { refresh(); }
  function route() { queueMicrotask(() => { if (active) refresh(); }); }
  try {
    const assets = document.querySelectorAll('link[rel="modulepreload"][href="./assets/app-initial-a9514281e192.js"]');
    if (assets.length !== 1) throw new Error("Unavailable native usage bridge");
    native = await import(assets[0].href);
    if (!active) return;
    disposers.push(native.xmn.subscribe("mcp-notification", notification));
    disposers.push(native.xmn.subscribe("codex-app-server-connection-changed", connection));
    disposers.push(native.xmn.subscribe("navigate-to-route", route));
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", owner.stop, { once: true });
    disposers.push(() => window.removeEventListener("focus", focus));
    disposers.push(() => window.removeEventListener("pagehide", owner.stop));
    bindClient();
    refresh();
  } catch {
    if (active) {
      owner.stop();
      // Keep a failed sentinel until explicit disable or reload; repeated
      // enable calls only replay unavailable instead of retrying imports.
      window[key] = owner;
    }
  }
}

// Runs in the main world to read React's current host props, never fibers or hooks.
// Audited against 26.901.41600; missing/ambiguous model ownership leaves native UI intact.
function syncWebAstraProLabels(enabled = true) {
  const key = "__codexWorkflowWebAstraProLabels";
  const previous = window[key] ||= new Map();
  const desired = new Map();
  const proLabel = "composer.mode.local.reasoning.high.label";
  const triggerSelector = '[data-codex-intelligence-trigger="true"][data-composer-navigation-target="reasoning"]';

  function children(element) {
    const propsKey = Object.keys(element).find((name) => name.startsWith("__reactProps$"));
    return propsKey ? element[propsKey]?.children : null;
  }

  function visit(value, callback, depth = 0) {
    if (!value || typeof value !== "object" || depth > 8) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, callback, depth + 1);
    } else if (value.props) {
      callback(value.props);
      visit(value.props.children, callback, depth + 1);
    }
  }

  function modelsWithin(element) {
    const models = new Set();
    for (const child of [element, ...element.querySelectorAll("span")]) {
      visit(children(child), (props) => {
        // Native ModelDisplayName receives both model and displayName, including undefined.
        if (typeof props.model === "string" && Object.hasOwn(props, "displayName")) models.add(props.model);
      });
    }
    return models;
  }

  function isProCarrierLabel(element) {
    let found = false;
    visit(children(element), (props) => { if (props.id === proLabel) found = true; });
    return found;
  }

  function collect(scope, model, effortOnly) {
    for (const element of [scope, ...scope.querySelectorAll("span, [data-effort-only]")]) {
      if (!isProCarrierLabel(element)) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      // Only the native effort label, never a whole model name or a parent containing other text.
      if (texts.length !== 1) continue;
      const text = texts[0];
      let ownerModel = model;
      let explicitOwner = false;
      for (let parent = element; parent && scope.contains(parent); parent = parent.parentElement) {
        if (parent === scope || parent.querySelectorAll('[role="menuitem"]').length > 1) break;
        const models = modelsWithin(parent);
        if (models.size) {
          ownerModel = models.size === 1 ? [...models][0] : null;
          explicitOwner = true;
          break;
        }
      }
      if (ownerModel === "chatgpt-web/astra" && (effortOnly || explicitOwner)) desired.set(text, "Pro");
    }
  }

  if (enabled) {
    for (const trigger of document.querySelectorAll(triggerSelector)) {
      if (!trigger.closest('[role="presentation"][data-composer-layout]')) continue;
      const models = modelsWithin(trigger);
      if (models.size !== 1) continue;
      const model = [...models][0];
      if (model !== "chatgpt-web/astra") continue;
      collect(trigger, model, trigger.dataset.selectedReasoningEffort === "high");
      for (const menu of document.querySelectorAll('[role="menu"][aria-labelledby]')) {
        if (!trigger.id || menu.getAttribute("aria-labelledby") !== trigger.id) continue;
        // An explicit-model slider and the advanced reasoning menu each own one model's efforts.
        // Mixed-model power presets must retain their own labels.
        const mixedSlider = menu.querySelector('[data-model-picker-view="simple"]') &&
          !menu.querySelector('[data-explicit-model="true"], [data-effort-only="true"]');
        collect(menu, model, !mixedSlider);
      }
      for (const id of (trigger.getAttribute("aria-describedby") || "").split(/\s+/u)) {
        const tooltip = id && document.getElementById(id);
        if (tooltip?.getAttribute("role") === "tooltip") collect(tooltip, model, true);
      }

    }
  }

  for (const [node, snapshot] of previous) {
    if (desired.has(node) && node.isConnected) continue;
    if (node.data === snapshot.applied) node.data = snapshot.original;
    previous.delete(node);
  }
  for (const [node, label] of desired) {
    const snapshot = previous.get(node);
    if (!snapshot || node.data !== snapshot.applied) previous.set(node, { original: node.data, applied: label });
    if (node.data !== label) node.data = label;
  }
}


function isTopFrame() { try { return window.top === window; } catch { return false; } }

// Settings shell, navigation snapshots and primitives come from the audited
// 26.901.41600 renderer. Previous customisations are parked outside runtime/.
if (!globalThis.__codexWorkflowPreloadInstalled && isTopFrame()) {
  globalThis.__codexWorkflowPreloadInstalled = true;
  const defaults = {
    schemaVersion: 3, focusedInterface: true, hidePullRequests: true,
    hidePetMenuItem: true, hideInviteFriendMenuItem: true,
    replaceHelpWithSettings: true, hideComposerMicrophone: false,
    showUsageRemaining: true, usageRemainingLocation: "toolbar",
    hiddenSettingsPages: [],
    sidebarNavigation: {
      order: ["pull-requests", "scheduled", "plugins", "explore", "settings-shortcut"],
      hidden: [],
      width: null,
      showRecentChats: true,
      settingsOrder: [], settingsHidden: [],
      accountOrder: ["usage", "pet", "invite", "settings", "logout"], accountHidden: [],
    },
  };
  const sections = [
    ["sidebar", "Sidebar & navigation", "Visibility, ordering and shortcuts"],
    ["composer", "Composer", "Controls, microphone and usage placement"],
    ["conversation", "Conversation", "Width, spacing and tool output"],
    ["appearance", "Appearance & spacing", "Density, fonts and native theme settings"],
    ["usage", "Usage & indicators", "Choose what appears and where"],
  ];
  const state = {
    settings: { ...defaults }, settingsWriteInFlight: false, settingControls: new Map(),
    settingsShell: null, settingsNav: null, navWithListener: null, customNav: null,
    customInactiveSnapshot: null, nativeSnapshot: null, loggedSettingsShell: false,
    panel: null, contentArea: null, activeWorkflow: false,
    workflowEntryLocation: null, workflowNativeSlug: null,
    hiddenContent: new Map(), observer: null, mountObservers: [],
    discoveryObserver: null, discoveryTimer: null, scheduled: false,
    query: "", changedOnly: false, filterSwitch: null, resetButton: null, status: null, sectionRows: [],
    page: "home", navigationTab: "app", navigationStyle: null,
    navigationRoot: null, navigationObserver: null, navigationMountObservers: [],
    accountObserver: null, accountTimer: null, accountSizing: null, icons: new Map(),
    navigationControls: [], widthInput: null, drag: null,
    composerRoot: null, composerObserver: null, composerMountObservers: [],
    webAstraProPortals: new Map(), webAstraProPending: false, webAstraProDirty: false,
    usageData: null, usageButton: null, usagePlacement: null,
    usageToolbar: null, usageToolbarObserver: null, usageMountObservers: [],
    usageBridgeEnabled: false, usageBridgeInFlight: false,
    usageTooltip: null, usageTooltipTimer: null, usageLocationMenuClose: null,
    loggedAmbiguousComposerMicrophone: false,
    updateStatus: { available: false }, updateButton: null, updateApplying: false,
  };

  const composerRootSelector = '[role="presentation"][data-composer-layout]';
  const usageToolbarSelector = 'header[data-app-shell-header-layout] [data-app-shell-header-toolbar="true"]';

  queueMicrotask(async () => {
    if (location.protocol !== "app:") return;
    try {
      state.settings = normaliseSettings(await ipcRenderer.invoke("codex-workflow:settings:get"));
    } catch (error) { log("error", `settings read failed: ${error?.message || error}`); }
    const boot = () => {
      ipcRenderer.on("codex-workflow:update:status", (_event, status) => {
        state.updateStatus = status || { available: false };
        refreshUpdateControl();
      });
      ipcRenderer.invoke("codex-workflow:update:get").then(status => {
        state.updateStatus = status || { available: false };
        refreshUpdateControl();
      }).catch(error => log("error", `update status unavailable: ${error?.message || error}`));
      window.addEventListener("codex-workflow:usage", (event) => {
        if (!state.settings.showUsageRemaining || typeof event.detail !== "string" || event.detail.length > 4096) return;
        try { state.usageData = JSON.parse(event.detail); updateUsageText(); } catch {}
      });
      window.addEventListener("blur", () => { hideUsageTooltip(); closeUsageLocationMenu(); });
      window.addEventListener("resize", () => { hideUsageTooltip(); closeUsageLocationMenu(); });
      document.addEventListener("keydown", event => { if (event.key === "Escape") hideUsageTooltip(); }, true);
      syncNavigation();
      for (const method of ["pushState", "replaceState"]) {
        const original = history[method];
        history[method] = function (...args) {
          const before = location.href;
          const result = original.apply(this, args);
          if (before !== location.href) restoreNativeSettingsView();
          beginDiscovery();
          return result;
        };
      }
      for (const type of ["popstate", "hashchange"]) {
        window.addEventListener(type, () => { restoreNativeSettingsView(); beginDiscovery(); });
      }
      window.addEventListener("resize", beginDiscovery, { passive: true });
      document.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === ",") beginDiscovery();
      }, true);
      document.addEventListener("click", (event) => {
        if (state.panel?.contains(event.target)) return;
        const target = event.target instanceof Element ? event.target.closest("button, a, [role=menuitem]") : null;
        if (target && /settings/iu.test(target.getAttribute("aria-label") || target.textContent)) beginDiscovery();
      }, true);
      const discoverAccount = (event) => {
        if (!event.target?.closest?.('[aria-label="Open profile menu"]')) return;
        state.accountObserver?.disconnect();
        clearTimeout(state.accountTimer);
        state.accountObserver = new MutationObserver(syncAccountNavigation);
        state.accountObserver.observe(document.body, { childList: true, subtree: true });
        state.accountTimer = setTimeout(() => { state.accountObserver?.disconnect(); state.accountObserver = null; }, 1500);
      };
      document.addEventListener("pointerdown", discoverAccount, true);
      document.addEventListener("click", discoverAccount, true);
      document.addEventListener("keydown", followVisibleNavigationOrder, true);
      document.addEventListener("keydown", (event) => {
        if (["Enter", " ", "ArrowDown"].includes(event.key)) discoverAccount(event);
      }, true);
      beginDiscovery();
      log("info", "starter settings preload started");
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  });

  function beginDiscovery() {
    if (!document?.documentElement) return;
    syncNavigation();
    if (!state.discoveryObserver) {
      state.discoveryObserver = new MutationObserver((records) => {
        if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) =>
          node instanceof Element && (node.matches('nav[aria-label="Settings"], [data-settings-panel-slug], #app-shell-sidebar, [data-composer-layout], [data-app-shell-header-toolbar]') ||
          node.querySelector('nav[aria-label="Settings"], [data-settings-panel-slug], #app-shell-sidebar, [data-composer-layout], [data-app-shell-header-toolbar]'))))) {
          syncNavigation();
          scheduleWork();
        }
      });
      state.discoveryObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    clearTimeout(state.discoveryTimer);
    state.discoveryTimer = setTimeout(stopDiscovery, 10000);
    scheduleWork();
  }

  function stopDiscovery() {
    state.discoveryObserver?.disconnect();
    state.discoveryObserver = null;
    clearTimeout(state.discoveryTimer);
    state.discoveryTimer = null;
  }

  function scheduleWork() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      try {
        syncNavigation();
        syncAuxiliary();
        const shell = findSettingsShell();
        if (!shell) {
          if (state.settingsShell) releaseShell();
          return;
        }
        if (state.settingsShell !== shell) {
          const reopen = state.activeWorkflow;
          releaseShell();
          state.activeWorkflow = reopen;
          state.settingsShell = shell;
          state.observer = new MutationObserver((records) => {
            if (records.some((record) => !state.panel?.contains(record.target) &&
              [...record.addedNodes, ...record.removedNodes].some((node) =>
                !(node instanceof Element) || !node.matches("[data-codex-workflow-panel], [data-codex-workflow=nav-item]")))) scheduleWork();
          });
          state.observer.observe(shell, { childList: true, subtree: true });
          let child = shell;
          while (child?.parentElement) {
            const parent = child.parentElement;
            const observer = new MutationObserver(() => {
              if (!shell.isConnected) {
                const reopen = state.activeWorkflow;
                releaseShell();
                state.activeWorkflow = reopen;
                beginDiscovery();
              }
            });
            observer.observe(parent, { childList: true });
            state.mountObservers.push(observer);
            if (parent === document.body) break;
            child = parent;
          }
        }
        syncSettingsPage();
        if (state.customNav?.isConnected) stopDiscovery();
      } catch (error) { log("error", `starter sync failed: ${error?.message || error}`); }
    });
  }

  function releaseShell() {
    state.observer?.disconnect();
    state.observer = null;
    for (const observer of state.mountObservers) observer.disconnect();
    state.mountObservers = [];
    releaseSettingsMount();
    state.settingsShell = null;
  }

  function releaseSettingsMount() {
    restoreNativeSettingsView();
    state.navWithListener?.removeEventListener("click", onSettingsNavClick, true);
    state.navWithListener = null;
    state.customNav?.remove();
    state.customNav = null;
    state.customInactiveSnapshot = null;
    state.settingsNav = null;
  }

  function activateWorkflowPanel() {
    const nav = state.settingsNav;
    const content = nav && findContentArea(nav);
    if (!content) return;
    state.contentArea = content;
    for (const child of content.children) {
      if (!(child instanceof HTMLElement) || child === state.panel) continue;
      if (!state.hiddenContent.has(child)) {
        state.hiddenContent.set(child, {
          display: child.style.getPropertyValue("display"),
          priority: child.style.getPropertyPriority("display"),
          style: child.getAttribute("style"), inert: child.hasAttribute("inert"),
        });
        if (child.contains(document.activeElement)) state.customNav?.focus({ preventScroll: true });
      }
      if (child.style.getPropertyValue("display") !== "none") child.style.setProperty("display", "none", "important");
      child.inert = true;
    }
    if (!state.panel?.isConnected || state.panel.parentElement !== content) {
      state.panel?.remove();
      state.panel = renderWorkflowPanel();
      content.append(state.panel);
    }
    muteNativeActiveNav(nav);
  }

  function restoreNativeSettingsView() {
    closeUsageLocationMenu();
    state.drag?.cancel();
    restoreVisualState(state.nativeSnapshot);
    state.nativeSnapshot = null;
    restoreVisualState(state.customInactiveSnapshot);
    for (const [child, saved] of state.hiddenContent) {
      if (child.style.getPropertyValue("display") === "none" && child.style.getPropertyPriority("display") === "important") {
        if (saved.display) child.style.setProperty("display", saved.display, saved.priority);
        else child.style.removeProperty("display");
        if (saved.style === null && !child.getAttribute("style")) child.removeAttribute("style");
      }
      if (!saved.inert) { child.inert = false; child.removeAttribute("inert"); }
    }
    state.hiddenContent.clear();
    state.panel?.remove();
    state.panel = null;
    state.settingControls.clear();
    state.filterSwitch = null;
    state.resetButton = null;
    state.status = null;
    state.contentArea = null;
    state.activeWorkflow = false;
    state.workflowEntryLocation = null;
    state.workflowNativeSlug = null;
  }


  function renderWorkflowPanel() {
    state.settingControls.clear();
    state.navigationControls = [];
    state.widthInput = null;
    state.sectionRows = [];
    const shell = div("flex h-full w-full min-h-0 flex-col electron:overflow-hidden electron:bg-surface electron:elevation-prominent windows:rounded-tl-lg");
    shell.dataset.codexWorkflowPanel = "true";
    const toolbar = div("flex items-center px-panel draggable electron:h-toolbar extension:h-toolbar-sm");
    const scroller = div("flex-1 scrollbar-stable overflow-y-auto p-panel");
    const page = div("mx-auto flex w-full max-w-3xl flex-col electron:min-w-[calc(320px*var(--codex-window-zoom))]");
    if (["composer", "usage"].includes(state.page)) {
      renderControlsPage(page);
      scroller.append(page);
      shell.append(toolbar, scroller);
      return shell;
    }
    if (state.page === "sidebar") {
      renderNavigationPage(page);
      scroller.append(page);
      shell.append(toolbar, scroller);
      return shell;
    }
    const titleWrap = div("pb-8");
    const title = document.createElement("h1");
    title.className = "min-w-0 break-words text-default heading-lg font-normal";
    title.textContent = "Workflow";
    titleWrap.append(title);
    const stack = div("flex flex-col gap-10");
    const setup = sectionHeading("Your setup");
    const setupCard = settingsCard();
    setupCard.append(renderSettingRow({
      key: "focusedInterface", label: "Enable customisations",
      description: "Apply your Workflow customisations to Codex.",
    }));
    setup.append(setupCard);

    const customise = sectionHeading("Customise");
    const filter = div("flex max-w-full shrink-0 items-center gap-2");
    const filterLabel = div("text-xs leading-4 text-secondary");
    filterLabel.id = "codex-workflow-changed-label";
    filterLabel.textContent = "Show changed only";
    // Reuse the native switch, keeping this view filter out of persisted preferences.
    const filterSwitch = renderSwitch({ key: "changedOnly", labelId: filterLabel.id,
      descriptionId: "codex-workflow-section-status" });
    state.filterSwitch = state.settingControls.get("changedOnly");
    state.settingControls.delete("changedOnly");
    state.filterSwitch.apply(state.changedOnly);
    filter.append(filterLabel, filterSwitch);
    customise.firstElementChild.append(filter);
    const content = div("flex flex-col gap-3");
    const search = renderSearch();
    const card = settingsCard();
    card.dataset.codexWorkflow = "sections";
    for (const [key, label, description] of sections) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "no-drag cursor-interaction flex items-center justify-between px-4 gap-6 py-3 text-start enabled:hover:bg-text/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
      row.dataset.codexWorkflowSection = key;
      if (!["sidebar", "composer", "usage"].includes(key)) row.setAttribute("aria-disabled", "true");
      else row.addEventListener("click", () => { state.page = key; redrawWorkflowPanel(); });
      row.setAttribute("aria-label", label);
      const copy = div("flex min-w-0 flex-1 flex-col gap-0.5");
      const name = div("min-w-0 text-sm text-default font-medium");
      name.textContent = label;
      const detail = div("min-w-0 text-xs leading-4 text-balance text-secondary");
      detail.textContent = description;
      copy.append(name, detail);
      const status = div("flex shrink-0 items-center gap-4 text-xs text-secondary");
      const changes = sectionChangeCount(key);
      status.textContent = changes ? `${changes} ${changes === 1 ? "change" : "changes"}` : "Default";
      const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      chevron.setAttribute("class", "icon-sm");
      chevron.setAttribute("viewBox", "0 0 24 24");
      chevron.setAttribute("fill", "none");
      chevron.setAttribute("stroke", "currentColor");
      chevron.setAttribute("stroke-width", "1.5");
      chevron.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "m9 18 6-6-6-6");
      chevron.append(path);
      status.append(chevron);
      row.append(copy, status);
      state.sectionRows.push(row);
      card.append(row);
    }
    const empty = div("px-4 py-3 text-sm text-secondary");
    empty.dataset.codexWorkflow = "empty";
    empty.setAttribute("role", "status");
    const sectionStatus = div("sr-only");
    sectionStatus.id = "codex-workflow-section-status";
    sectionStatus.textContent = "Show sections with preferences changed from their defaults.";
    content.append(search, card, empty, sectionStatus);
    customise.append(content);

    const footer = div("flex flex-wrap items-center justify-between gap-4");
    const status = div("text-xs leading-4 text-secondary");
    status.setAttribute("role", "status");
    state.status = status;
    const reset = renderActionButton("Reset Workflow changes", true);
    reset.dataset.codexWorkflow = "reset";
    reset.addEventListener("click", () => {
      if (state.settingsWriteInFlight) return;
      state.query = "";
      state.changedOnly = false;
      search.querySelector("input").value = "";
      refreshFilters(shell);
      persistSetting("reset", true);
    });
    state.resetButton = reset;
    const update = renderActionButton("Update Workflow");
    update.dataset.codexWorkflow = "update";
    state.updateButton = update;
    update.addEventListener("click", async () => {
      if (!state.updateStatus.available || state.updateApplying) return;
      state.updateApplying = true;
      refreshUpdateControl();
      try {
        const result = await ipcRenderer.invoke("codex-workflow:update:install");
        if (!result?.applying) throw new Error("Update was not applied");
      } catch (error) {
        state.updateApplying = false;
        status.textContent = "Couldn’t update Workflow. Please try again.";
        log("error", `update failed: ${error?.message || error}`);
        refreshUpdateControl();
      }
    });
    footer.append(status, update, reset);
    refreshUpdateControl();
    stack.append(setup, customise, footer);
    page.append(titleWrap, stack);
    scroller.append(page);
    shell.append(toolbar, scroller);
    refreshFilters(shell);
    refreshSettingControls();
    return shell;
  }


  function refreshUpdateControl() {
    const button = state.updateButton;
    if (!button) return;
    button.hidden = !state.updateStatus.available;
    button.style.display = state.updateStatus.available ? "" : "none";
    button.disabled = state.updateApplying;
    button.textContent = state.updateApplying ? "Updating…" : "Update Workflow";
  }

  function sectionChangeCount(key) {
    if (key === "sidebar") return navigationChangeCount();
    const keys = key === "composer" ? ["hideComposerMicrophone"] : key === "usage" ? ["showUsageRemaining", "usageRemainingLocation"] : [];
    return keys.filter(name => state.settings[name] !== defaults[name]).length;
  }

  function renderControlsPage(page) {
    const header = div("flex flex-col gap-4 pb-8");
    const back = renderActionButton("Workflow");
    back.prepend(navigationGlyph("back"));
    back.classList.add("self-start");
    back.addEventListener("click", () => { state.page = "home"; redrawWorkflowPanel(); });
    const title = document.createElement("h1");
    title.className = "min-w-0 break-words text-default heading-lg font-normal";
    title.tabIndex = -1;
    title.textContent = sections.find(([key]) => key === state.page)[1];
    header.append(back, title);
    const card = settingsCard();
    card.append(state.page === "usage" ? renderUsageRemainingRow() : renderSettingRow({
      key: "hideComposerMicrophone", label: "Hide microphone button", description: "Remove the idle Dictate button from the composer.",
    }));
    const status = div("text-xs leading-4 text-secondary");
    status.setAttribute("role", "status");
    state.status = status;
    page.append(header, card, status);
    refreshSettingControls();
  }

  function disconnectObservers(observers) { for (const observer of observers) observer.disconnect(); }

  function observeMountChain(kind, root) {
    const observers = [];
    for (let child = root; child?.parentElement; child = child.parentElement) {
      const observer = new MutationObserver(() => {
        if (!root.isConnected) {
          if (kind === "usage") releaseUsageToolbar();
          beginDiscovery();
        }
      });
      observer.observe(child.parentElement, { childList: true });
      observers.push(observer);
      if (child.parentElement === document.body) break;
    }
    return observers;
  }

  function syncAuxiliary() {
    const roots = [...document.querySelectorAll(composerRootSelector)];
    const root = roots.length === 1 ? roots[0] : null;
    if (state.composerRoot !== root) {
      state.composerObserver?.disconnect();
      disconnectObservers(state.composerMountObservers);
      restoreComposerMicrophones(state.composerRoot);
      state.composerRoot = root;
      state.composerMountObservers = [];
      if (root) {
        state.composerObserver = new MutationObserver(() => scheduleWork());
        state.composerObserver.observe(root, { childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter: ["aria-label", "aria-controls", "aria-describedby", "data-selected-reasoning-effort"] });
        state.composerMountObservers = observeMountChain("composer", root);
      }
    }
    syncComposerMicrophone();
    syncUsageRemaining();
    syncWebAstraPro();
  }

  function renderUsageRemainingRow() {
    const row = renderSettingRow({
      key: "showUsageRemaining",
      label: "Usage remaining",
      description: "Show your remaining allowance. Hover to see the limit; click to open Usage.",
    });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "no-drag cursor-interaction items-center select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-40 gap-1 border whitespace-nowrap flex rounded-lg border-default bg-primary-soft-alpha enabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover h-token-button-composer py-0 text-base leading-[18px] max-w-full justify-between px-3";
    button.setAttribute("aria-label", "Usage remaining location");
    button.setAttribute("aria-describedby", "codex-workflow-showUsageRemaining-description");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.dataset.state = "closed";
    const label = document.createElement("span");
    label.className = "flex min-w-0 flex-1 items-center gap-1.5";
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("viewBox", "0 0 20 21");
    chevron.setAttribute("class", "icon-2xs shrink-0 text-tertiary");
    chevron.setAttribute("fill", "none");
    chevron.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(chevron.namespaceURI, "path");
    path.setAttribute("d", "M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "0.6");
    chevron.append(path);
    button.append(label, chevron);
    const apply = (value) => { label.textContent = value === "composer" ? "Composer" : "Toolbar"; };
    const applyDisabled = (disabled) => {
      button.disabled = disabled || !state.settings.showUsageRemaining;
      if (button.disabled) closeUsageLocationMenu();
    };
    state.settingControls.set("usageRemainingLocation", { button, apply, applyDisabled });
    apply(state.settings.usageRemainingLocation);
    applyDisabled(state.settingsWriteInFlight);
    const open = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled || state.settingsWriteInFlight) return;
      if (state.usageLocationMenuClose) closeUsageLocationMenu(true);
      else openUsageLocationMenu(button);
    };
    button.addEventListener("click", open);
    button.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) open(event);
    });
    row.lastElementChild.prepend(button);
    return row;
  }

  function closeUsageLocationMenu(restoreFocus = false) {
    state.usageLocationMenuClose?.(restoreFocus);
  }

  function openUsageLocationMenu(trigger) {
    const menu = div("no-drag z-50 m-px flex select-none flex-col overflow-y-auto bg-surface-elevated-secondary/90 text-default ring-border ring-[0.5px] shadow-xl-spread backdrop-blur-sm rounded-2xl p-[var(--menu-gutter,var(--spacing))] w-[240px]");
    menu.id = "codex-workflow-usage-location-menu";
    menu.dataset.codexWorkflow = "usage-location-menu";
    menu.dataset.state = "open";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Usage remaining location");
    menu.style.position = "fixed";
    menu.style.maxWidth = "calc(100vw - 16px)";
    menu.style.maxHeight = "calc(100vh - 16px)";
    const items = ["toolbar", "composer"].map((value) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "no-drag w-full text-default outline-hidden rounded-xl p-[var(--menu-item-padding,var(--padding-row-y)_var(--padding-row-x))] text-sm _comboboxRow_1jprg_2 group hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover cursor-interaction";
      item.dataset.value = value;
      item.setAttribute("role", "menuitemradio");
      const selected = state.settings.usageRemainingLocation === value;
      item.setAttribute("aria-checked", String(selected));
      item.tabIndex = selected ? 0 : -1;
      const row = div("flex w-full items-center gap-1.5");
      const label = div("min-w-0 flex-1 truncate text-start");
      label.textContent = value === "toolbar" ? "Toolbar" : "Composer";
      row.append(label);
      if (selected) {
        const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        check.setAttribute("viewBox", "0 0 17 17");
        check.setAttribute("class", "icon-xs shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100");
        check.setAttribute("aria-hidden", "true");
        const path = document.createElementNS(check.namespaceURI, "path");
        path.setAttribute("d", "M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z");
        path.setAttribute("fill", "currentColor");
        check.append(path);
        row.append(check);
      }
      item.append(row);
      item.addEventListener("click", async () => {
        closeUsageLocationMenu(true);
        if (trigger.isConnected && !trigger.disabled && !state.settingsWriteInFlight && value !== state.settings.usageRemainingLocation) {
          await persistSetting("usageRemainingLocation", value);
          if (trigger.isConnected && !trigger.disabled &&
            (document.activeElement === document.body || document.activeElement === trigger)) trigger.focus({ preventScroll: true });
        }
      });
      item.addEventListener("pointermove", () => item.focus({ preventScroll: true }));
      menu.append(item);
      return item;
    });
    const outside = (event) => { if (!menu.contains(event.target) && !trigger.contains(event.target)) closeUsageLocationMenu(); };
    const scroll = (event) => { if (!menu.contains(event.target)) closeUsageLocationMenu(); };
    state.usageLocationMenuClose = (restoreFocus) => {
      state.usageLocationMenuClose = null;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scroll, true);
      menu.remove();
      trigger.dataset.state = "closed";
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-controls");
      if (restoreFocus && trigger.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    };
    menu.addEventListener("keydown", (event) => {
      if (["Escape", "Tab"].includes(event.key)) {
        if (event.key === "Escape") event.preventDefault();
        closeUsageLocationMenu(true);
        return;
      }
      const current = items.indexOf(document.activeElement);
      const index = event.key === "ArrowDown" ? (current + 1) % items.length :
        event.key === "ArrowUp" ? (current + items.length - 1) % items.length :
          event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
            event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey ? items.findIndex((item) => item.textContent.toLowerCase().startsWith(event.key.toLowerCase())) : -1;
      if (index >= 0) { event.preventDefault(); items[index].focus({ preventScroll: true }); }
    });
    menu.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !menu.contains(event.relatedTarget) && event.relatedTarget !== trigger) closeUsageLocationMenu();
    });
    document.body.append(menu);
    const rect = trigger.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - size.width, innerWidth - size.width - 8))}px`;
    menu.style.top = `${Math.max(8, rect.bottom + size.height + 4 <= innerHeight - 8 ? rect.bottom + 4 : rect.top - size.height - 4)}px`;
    trigger.dataset.state = "open";
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", menu.id);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true);
    items.find((item) => item.getAttribute("aria-checked") === "true").focus({ preventScroll: true });
  }

  function syncComposerMicrophone() {
    const root = state.composerRoot;
    const matching = root?.isConnected
      ? Array.from(root.querySelectorAll('[data-composer-rows] button[aria-label="Dictate"]'))
        .filter((button) => button instanceof HTMLButtonElement &&
          button.closest(composerRootSelector) === root)
      : [];
    const owned = Array.from(document.querySelectorAll(
      '[data-codex-workflow-composer-microphone-hidden="true"]',
    ));
    const target = state.settings.hideComposerMicrophone && matching.length === 1
      ? matching[0]
      : null;

    for (const element of owned) {
      if (element !== target) restoreComposerMicrophone(element);
    }

    if (state.settings.hideComposerMicrophone && matching.length > 1) {
      if (!state.loggedAmbiguousComposerMicrophone) {
        state.loggedAmbiguousComposerMicrophone = true;
        log("error", `composer microphone target ambiguous: ${matching.length} candidates`);
      }
      return;
    }
    if (matching.length <= 1 || !state.settings.hideComposerMicrophone) {
      state.loggedAmbiguousComposerMicrophone = false;
    }
    if (!(target instanceof HTMLButtonElement)) return;

    if (!target.hasAttribute("data-codex-workflow-composer-microphone-hidden")) {
      target.dataset.codexWorkflowComposerMicrophoneOriginalDisplay =
        target.style.getPropertyValue("display");
      target.dataset.codexWorkflowComposerMicrophoneOriginalDisplayPriority =
        target.style.getPropertyPriority("display");
      target.dataset.codexWorkflowComposerMicrophoneHadAriaHidden =
        String(target.hasAttribute("aria-hidden"));
      target.dataset.codexWorkflowComposerMicrophoneOriginalAriaHidden =
        target.getAttribute("aria-hidden") || "";
      target.dataset.codexWorkflowComposerMicrophoneHadTabindex =
        String(target.hasAttribute("tabindex"));
      target.dataset.codexWorkflowComposerMicrophoneOriginalTabindex =
        target.getAttribute("tabindex") || "";
      target.dataset.codexWorkflowComposerMicrophoneHidden = "true";
    }
    if (document.activeElement === target) target.blur();
    target.style.setProperty("display", "none", "important");
    target.setAttribute("aria-hidden", "true");
    target.setAttribute("tabindex", "-1");
  }

  function restoreComposerMicrophones(root) {
    for (const element of root?.querySelectorAll?.(
      '[data-codex-workflow-composer-microphone-hidden="true"]',
    ) || []) {
      restoreComposerMicrophone(element);
    }
  }

  function restoreComposerMicrophone(element) {
    if (!(element instanceof HTMLElement) ||
      !element.hasAttribute("data-codex-workflow-composer-microphone-hidden")) return;
    const originalDisplay = element.dataset.codexWorkflowComposerMicrophoneOriginalDisplay || "";
    if (originalDisplay) {
      element.style.setProperty(
        "display",
        originalDisplay,
        element.dataset.codexWorkflowComposerMicrophoneOriginalDisplayPriority || "",
      );
    } else {
      element.style.removeProperty("display");
    }
    if (element.dataset.codexWorkflowComposerMicrophoneHadAriaHidden === "true") {
      element.setAttribute(
        "aria-hidden",
        element.dataset.codexWorkflowComposerMicrophoneOriginalAriaHidden || "",
      );
    } else {
      element.removeAttribute("aria-hidden");
    }
    if (element.dataset.codexWorkflowComposerMicrophoneHadTabindex === "true") {
      element.setAttribute(
        "tabindex",
        element.dataset.codexWorkflowComposerMicrophoneOriginalTabindex || "",
      );
    } else {
      element.removeAttribute("tabindex");
    }
    delete element.dataset.codexWorkflowComposerMicrophoneOriginalDisplay;
    delete element.dataset.codexWorkflowComposerMicrophoneOriginalDisplayPriority;
    delete element.dataset.codexWorkflowComposerMicrophoneHadAriaHidden;
    delete element.dataset.codexWorkflowComposerMicrophoneOriginalAriaHidden;
    delete element.dataset.codexWorkflowComposerMicrophoneHadTabindex;
    delete element.dataset.codexWorkflowComposerMicrophoneOriginalTabindex;
    delete element.dataset.codexWorkflowComposerMicrophoneHidden;
  }

  async function syncUsageBridge() {
    if (!webFrame?.executeJavaScript || state.usageBridgeInFlight ||
      state.usageBridgeEnabled === state.settings.showUsageRemaining) return;
    const enabled = state.settings.showUsageRemaining;
    state.usageBridgeInFlight = true;
    try {
      await webFrame.executeJavaScript(`(${installNativeUsageBridge.toString()})(${enabled})`);
      state.usageBridgeEnabled = enabled;
    } catch {
      state.usageData = null;
      updateUsageText();
    } finally {
      state.usageBridgeInFlight = false;
      if (enabled !== state.settings.showUsageRemaining) syncUsageBridge();
    }
  }

  function visibleUsageTarget(element) {
    return element instanceof HTMLElement && element.isConnected &&
      !element.closest('[aria-hidden="true"], [hidden], [role="dialog"], [role="menu"], [cmdk-root]') &&
      getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden" &&
      element.getBoundingClientRect().height > 0;
  }

  function releaseUsageToolbar() {
    state.usageToolbarObserver?.disconnect();
    state.usageToolbarObserver = null;
    disconnectObservers(state.usageMountObservers);
    state.usageMountObservers = [];
    state.usageToolbar = null;
  }

  function syncUsageRemaining() {
    syncUsageBridge();
    const placement = state.settings.usageRemainingLocation;
    let owner = null;
    let anchor = null;
    let template = null;
    if (state.settings.showUsageRemaining && placement === "composer") {
      const buttons = Array.from(state.composerRoot?.querySelectorAll(
        '[data-composer-rows] button[data-composer-navigation-target="permissions"]',
      ) || []).filter(visibleUsageTarget);
      if (buttons.length === 1) {
        anchor = template = buttons[0];
        owner = anchor.parentElement;
      }
    } else if (state.settings.showUsageRemaining) {
      const toolbars = Array.from(document.querySelectorAll(usageToolbarSelector)).filter(visibleUsageTarget);
      if (toolbars.length === 1 && toolbars[0].children.length === 2) {
        const toolbar = toolbars[0];
        const actions = toolbar.lastElementChild;
        if (actions.classList.contains("justify-end") && actions.classList.contains("shrink-0")) {
          owner = actions;
          const share = Array.from(actions.querySelectorAll("button"))
            .filter((button) => visibleUsageTarget(button) && compactText(button.textContent) === "share");
          const native = share.length === 1 ? share[0] : Array.from(toolbar.closest("header").querySelectorAll("button[aria-label]"))
            .find((button) => visibleUsageTarget(button) && !button.dataset.codexWorkflowUsage);
          template = native || null;
          if (state.usageToolbar !== toolbar) {
            releaseUsageToolbar();
            state.usageToolbar = toolbar;
            state.usageToolbarObserver = new MutationObserver(() => scheduleWork("usage"));
            state.usageToolbarObserver.observe(toolbar, { childList: true, subtree: true });
            state.usageMountObservers = observeMountChain("usage", toolbar);
          }
        }
      }
    }
    if (placement !== "toolbar" || !owner) releaseUsageToolbar();
    if (!owner || !template) {
      removeUsageButton();
      if (!state.settings.showUsageRemaining) state.usageData = null;
      return;
    }
    if (!state.usageButton || state.usagePlacement !== placement) {
      removeUsageButton();
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.codexWorkflowUsage = placement;
      button.addEventListener("click", () => {
        hideUsageTooltip();
        restoreNativeSettingsView();
        window.dispatchEvent(new MessageEvent("message", { data: { type: "navigate-to-route", path: "/settings/usage" } }));
        beginDiscovery();
      });
      button.addEventListener("pointerenter", () => {
        clearTimeout(state.usageTooltipTimer);
        state.usageTooltipTimer = setTimeout(showUsageTooltip, 700);
      });
      button.addEventListener("pointerleave", hideUsageTooltip);
      button.addEventListener("focus", showUsageTooltip);
      button.addEventListener("blur", hideUsageTooltip);
      state.usageButton = button;
      state.usagePlacement = placement;
    }
    const button = state.usageButton;
    const classes = new Set(template.classList);
    for (const name of ["aspect-square", "!px-0", "group/sidebar-trigger", "browser:size-9", "ms-3"]) classes.delete(name);
    classes.add("shrink-0");
    classes.add("tabular-nums");
    if (placement === "composer") {
      classes.delete("text-tertiary");
      classes.add("text-default");
    }
    const className = Array.from(classes).join(" ");
    if (button.className !== className) button.className = className;
    if (placement === "composer") {
      if (anchor.nextElementSibling !== button) anchor.after(button);
    } else if (owner.firstElementChild !== button) owner.prepend(button);
    updateUsageText();
  }

  function removeUsageButton() {
    hideUsageTooltip();
    if (state.usageButton === document.activeElement) state.usageButton.blur();
    state.usageButton?.remove();
    state.usageButton = null;
    state.usagePlacement = null;
  }

  function updateUsageText() {
    const button = state.usageButton;
    if (!button) return;
    const limit = selectUsageWindow(state.usageData);
    const text = limit ? `${limit.remaining}%` : "—";
    const label = limit?.label || "Usage unavailable";
    if (button.textContent !== text) button.textContent = text;
    const accessible = limit ? `${label}: ${text} remaining. Open Usage settings` : "Usage unavailable. Open Usage settings";
    if (button.getAttribute("aria-label") !== accessible) button.setAttribute("aria-label", accessible);
    if (state.usageTooltip && state.usageTooltip.textContent !== label) state.usageTooltip.textContent = label;
  }

  function showUsageTooltip() {
    hideUsageTooltip();
    const button = state.usageButton;
    if (!button?.isConnected) return;
    const tooltip = div("w-fit text-sm whitespace-normal break-words select-none z-50 rounded-2xl border border-default bg-surface-elevated-secondary text-default px-2 py-1.5 pointer-events-none");
    tooltip.id = "codex-workflow-usage-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.dataset.codexWorkflow = "usage-tooltip";
    tooltip.textContent = selectUsageWindow(state.usageData)?.label || "Usage unavailable";
    tooltip.style.position = "fixed";
    document.body.append(tooltip);
    const rect = button.getBoundingClientRect();
    const size = tooltip.getBoundingClientRect();
    const spacing = 4; // Native Tooltip sideOffset in the audited build, in CSS pixels.
    const left = Math.max(spacing, Math.min(rect.left + (rect.width - size.width) / 2, innerWidth - size.width - spacing));
    const top = state.usagePlacement === "composer" ? rect.top - size.height - spacing : rect.bottom + spacing;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(spacing, Math.min(top, innerHeight - size.height - spacing))}px`;
    button.setAttribute("aria-describedby", tooltip.id);
    state.usageTooltip = tooltip;
  }

  function hideUsageTooltip() {
    clearTimeout(state.usageTooltipTimer);
    state.usageTooltipTimer = null;
    state.usageTooltip?.remove();
    state.usageTooltip = null;
    state.usageButton?.removeAttribute("aria-describedby");
  }

  function syncWebAstraPro() {
    if (!webFrame?.executeJavaScript) return;
    const triggers = Array.from(state.composerRoot?.querySelectorAll('[data-codex-intelligence-trigger="true"]') || []);
    const ids = new Set(triggers.map((trigger) => trigger.id).filter(Boolean));
    const descriptions = new Set(triggers.flatMap((trigger) => (trigger.getAttribute("aria-describedby") || "").split(/\s+/u)));
    const portals = new Set(Array.from(document.querySelectorAll('[role="menu"][aria-labelledby], [role="tooltip"][id]'))
      .filter((portal) => ids.has(portal.getAttribute("aria-labelledby")) || descriptions.has(portal.id)));
    for (const [portal, observer] of state.webAstraProPortals) {
      if (portals.has(portal)) continue;
      observer.disconnect();
      state.webAstraProPortals.delete(portal);
    }
    for (const portal of portals) {
      if (state.webAstraProPortals.has(portal)) continue;
      const observer = new MutationObserver(() => scheduleWork("composer"));
      observer.observe(portal, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-effort-only", "data-explicit-model", "data-model-picker-view"] });
      state.webAstraProPortals.set(portal, observer);
    }
    if (state.webAstraProPending) {
      state.webAstraProDirty = true;
      return;
    }
    state.webAstraProPending = true;
    webFrame.executeJavaScript(`(${syncWebAstraProLabels.toString()})(${Boolean(state.composerRoot?.isConnected)})`)
      .catch((error) => log("error", `Web Astra label sync failed: ${error?.message || error}`))
      .finally(() => {
        state.webAstraProPending = false;
        if (state.webAstraProDirty) {
          state.webAstraProDirty = false;
          scheduleWork("composer");
        }
      });
  }

  function sectionHeading(label) {
    const section = document.createElement("section");
    section.className = "flex flex-col";
    const header = div("flex justify-between gap-4 min-h-toolbar items-center pb-1.5");
    const title = document.createElement("h2");
    title.className = "font-medium text-default text-base";
    title.textContent = label;
    header.append(title);
    section.append(header);
    return section;
  }

  function renderSearch() {
    const native = state.settingsNav?.querySelector('input[role="searchbox"], input[type="search"], input#settings-search');
    const field = native?.parentElement?.cloneNode(true);
    const wrapper = field instanceof HTMLElement && field.querySelectorAll("input").length === 1
      ? field : div("no-drag flex items-center py-0 text-base leading-[18px] h-8 gap-2 rounded-full border border-primary-outline bg-background-primary-soft/90 px-2.5");
    scrubSidebarClone(wrapper);
    wrapper.querySelectorAll("button, label").forEach((element) => element.remove());
    const input = wrapper.querySelector("input") || document.createElement("input");
    input.className ||= "min-w-0 flex-1 bg-transparent text-default outline-none select-text placeholder:text-tertiary [&::placeholder]:select-none text-base leading-[18px]";
    input.id = "codex-workflow-search";
    input.type = "text";
    input.setAttribute("role", "searchbox");
    input.setAttribute("aria-label", "Search customisations");
    input.placeholder = "Search customisations…";
    input.autocomplete = "off";
    input.value = state.query;
    input.addEventListener("input", () => { state.query = input.value; refreshFilters(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        event.stopPropagation();
        input.value = "";
        state.query = "";
        refreshFilters();
      }
    });
    if (!input.parentElement) wrapper.append(input);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "flex shrink-0 cursor-interaction items-center justify-center text-secondary hover:text-default size-6";
    clear.setAttribute("aria-label", "Clear customisation search");
    clear.dataset.codexWorkflow = "search-clear";
    // The native Settings search clear icon (app-initial, VN).
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "icon-sm");
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("fill", "currentColor");
    icon.setAttribute("aria-hidden", "true");
    for (const d of [
      "M7.231 7.231a.665.665 0 0 1 .94 0L10 9.06l1.828-1.829.104-.085a.666.666 0 0 1 .921.922l-.084.104L10.94 10l1.829 1.828a.665.665 0 0 1-.94.94L10 10.94l-1.828 1.83a.665.665 0 0 1-.94-.94L9.06 10 7.23 8.172a.665.665 0 0 1 0-.94Z",
      "M10 2.085a7.915 7.915 0 1 1 0 15.83 7.915 7.915 0 0 1 0-15.83Zm0 1.33a6.585 6.585 0 1 0 0 13.17 6.585 6.585 0 0 0 0-13.17Z",
    ]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill-rule", "evenodd");
      icon.append(path);
    }
    clear.append(icon);
    clear.addEventListener("click", () => {
      state.query = "";
      input.value = "";
      refreshFilters();
      input.focus();
    });
    wrapper.append(clear);
    wrapper.dataset.codexWorkflow = "search";
    return wrapper;
  }

  function refreshFilters(panel = state.panel) {
    if (!panel) return;
    if (!panel.querySelector('[data-codex-workflow="sections"]')) return;
    const terms = compactText(state.query).split(/\s+/u).filter(Boolean);
    const rows = state.sectionRows.filter((row) => (!state.changedOnly ||
      (sectionChangeCount(row.dataset.codexWorkflowSection) > 0)) &&
      terms.every((term) => compactText(row.textContent).includes(term)));
    const visible = rows.length;
    const card = panel.querySelector('[data-codex-workflow="sections"]');
    card.replaceChildren(...rows);
    card.hidden = !visible;
    card.style.display = visible ? "" : "none";
    const empty = panel.querySelector('[data-codex-workflow="empty"]');
    empty.hidden = visible > 0;
    empty.textContent = state.changedOnly ? "No changed customisations." : "No matching customisations.";
    panel.querySelector('[data-codex-workflow="search-clear"]').style.display = state.query ? "" : "none";
    state.filterSwitch?.apply(state.changedOnly);
  }

  async function persistSetting(key, next) {
    if (key === "changedOnly") {
      state.changedOnly = !state.changedOnly;
      refreshFilters();
      return;
    }
    if (state.settingsWriteInFlight) return;
    const previous = state.settings;
    const focusedControl = document.activeElement;
    const patch = key === "reset" ? {...defaults, sidebarNavigation:{...defaults.sidebarNavigation}} : {[key]:next};
    state.settings = { ...previous, ...patch };
    state.settingsWriteInFlight = true;
    if (state.status) state.status.textContent = "";
    refreshSettingControls();
    syncNavigation();
    syncAuxiliary();
    try {
      state.settings = normaliseSettings(await ipcRenderer.invoke("codex-workflow:settings:set", patch));
    } catch (error) {
      state.settings = previous;
      if (state.status) state.status.textContent = "Couldn’t save changes. Please try again.";
      log("error", `settings write failed: ${error?.message || error}`);
    } finally {
      state.settingsWriteInFlight = false;
      syncNavigation();
      syncAuxiliary();
      refreshSettingControls();
      if (key === "sidebarNavigation" && state.page === "sidebar") refreshNavigationRows();
      if (focusedControl instanceof HTMLButtonElement && focusedControl.isConnected &&
        [document.body, document.documentElement].includes(document.activeElement)) {
        focusedControl.focus({ preventScroll: true });
      }
    }
  }

  function refreshSettingControls() {
    for (const [key, control] of state.settingControls) {
      control.apply(state.settings[key]);
      control.applyDisabled(state.settingsWriteInFlight);
    }
    if (state.resetButton) state.resetButton.disabled = state.settingsWriteInFlight;
    state.filterSwitch?.applyDisabled(state.settingsWriteInFlight);
    for (const control of state.navigationControls) control.disabled = state.settingsWriteInFlight || !state.settings.focusedInterface;
  }

  function normaliseSettings(value) {
    const legacyFocusedInterface = typeof value?.efficiencyMode === "boolean"
      ? value.efficiencyMode
      : defaults.focusedInterface;
    const sidebarNavigation = value?.sidebarNavigation && typeof value.sidebarNavigation === "object" && !Array.isArray(value.sidebarNavigation)
      ? value.sidebarNavigation
      : value?.schemaVersion < 3 ? {
        hidden: [value.hidePullRequests === true && "pull-requests", value.replaceHelpWithSettings === false && "settings-shortcut"].filter(Boolean),
        settingsHidden: value.hiddenSettingsPages,
        accountHidden: [value.hidePetMenuItem === true && "pet", value.hideInviteFriendMenuItem === true && "invite"].filter(Boolean),
      } : {};
    const sidebarItems = defaults.sidebarNavigation.order;
    return {
      schemaVersion: 3,
      focusedInterface: typeof value?.focusedInterface === "boolean"
        ? value.focusedInterface
        : legacyFocusedInterface,
      hidePullRequests: typeof value?.hidePullRequests === "boolean"
        ? value.hidePullRequests
        : defaults.hidePullRequests,
      hidePetMenuItem: typeof value?.hidePetMenuItem === "boolean"
        ? value.hidePetMenuItem
        : defaults.hidePetMenuItem,
      hideInviteFriendMenuItem: typeof value?.hideInviteFriendMenuItem === "boolean"
        ? value.hideInviteFriendMenuItem
        : defaults.hideInviteFriendMenuItem,
      replaceHelpWithSettings: typeof value?.replaceHelpWithSettings === "boolean"
        ? value.replaceHelpWithSettings
        : defaults.replaceHelpWithSettings,
      hideComposerMicrophone: typeof value?.hideComposerMicrophone === "boolean"
        ? value.hideComposerMicrophone
        : defaults.hideComposerMicrophone,
      showUsageRemaining: typeof value?.showUsageRemaining === "boolean" ? value.showUsageRemaining : defaults.showUsageRemaining,
      usageRemainingLocation: ["toolbar", "composer"].includes(value?.usageRemainingLocation) ? value.usageRemainingLocation : defaults.usageRemainingLocation,
      hiddenSettingsPages: Array.isArray(value?.hiddenSettingsPages)
        ? [...new Set(value.hiddenSettingsPages.slice(0, 100).filter((slug) =>
          typeof slug === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(slug) && slug !== "workflow"))]
        : [],
      sidebarNavigation: {
        order: [...new Set([...(Array.isArray(sidebarNavigation?.order) ? sidebarNavigation.order : []),
          ...sidebarItems].filter((id) => sidebarItems.includes(id)))],
        hidden: Array.isArray(sidebarNavigation?.hidden)
          ? [...new Set(sidebarNavigation.hidden.slice(0, 100).filter((item) => sidebarItems.includes(item)))]
          : [...defaults.sidebarNavigation.hidden],
        width: typeof sidebarNavigation?.width === "number" && Number.isFinite(sidebarNavigation.width)
          ? Math.min(520, Math.max(240, Math.round(sidebarNavigation.width)))
          : defaults.sidebarNavigation.width,
        showRecentChats: sidebarNavigation?.showRecentChats !== false,
        settingsOrder: normaliseNavigationIds(sidebarNavigation?.settingsOrder),
        settingsHidden: normaliseNavigationIds(sidebarNavigation?.settingsHidden).filter((id) => id !== "workflow"),
        accountOrder: [...new Set([...normaliseNavigationIds(sidebarNavigation?.accountOrder),
          ...defaults.sidebarNavigation.accountOrder].filter((id) => defaults.sidebarNavigation.accountOrder.includes(id)))],
        accountHidden: normaliseNavigationIds(sidebarNavigation?.accountHidden).filter((id) => ["usage", "pet", "invite"].includes(id)),
      },
    };
  }

  function normaliseNavigationIds(value) {
    return Array.isArray(value) ? [...new Set(value.slice(0, 100).filter((id) =>
      typeof id === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(id)))] : [];
  }

  const appNavigationLabels = { "new-chat": "New chat", "pull-requests": "Pull requests",
    scheduled: "Scheduled", plugins: "Plugins", explore: "Explore", "settings-shortcut": "Settings shortcut" };
  const accountNavigationLabels = {usage: "Usage", pet: "Show pet", invite: "Invite a friend", settings: "Settings", logout: "Log out"};
  const iconButtonClass = "no-drag flex size-6 shrink-0 items-center justify-center rounded-full cursor-interaction hover:bg-primary-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40";
  // Native Tabs page variant: tabs-bd1cb7e26bf5.js (staging), tabs-a1458634b2c1.js (installed).
  const segmentClass = "no-drag cursor-interaction items-center text-sm select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 flex min-w-0 gap-1.5 rounded-md px-2 py-1 font-medium shrink-0 whitespace-nowrap";

  function redrawWorkflowPanel() {
    state.drag?.cancel();
    const previous = state.panel;
    state.panel = renderWorkflowPanel();
    previous?.replaceWith(state.panel);
    state.panel.querySelector("h1")?.focus({preventScroll: true});
  }

  function navigationUpdate(patch) {
    return persistSetting("sidebarNavigation", {...state.settings.sidebarNavigation, ...patch});
  }

  function navigationChangeCount() {
    return Object.keys(defaults.sidebarNavigation).filter(key =>
      JSON.stringify(state.settings.sidebarNavigation[key]) !== JSON.stringify(defaults.sidebarNavigation[key])).length;
  }

  function navigationKeys() {
    return state.navigationTab === "settings" ? ["settingsOrder", "settingsHidden"] :
      state.navigationTab === "account" ? ["accountOrder", "accountHidden"] : ["order", "hidden"];
  }

  function navigationItems() {
    const prefs = state.settings.sidebarNavigation;
    if (state.navigationTab === "app") return ["new-chat", ...prefs.order].map(id => ({
      id, label: appNavigationLabels[id], locked: id === "new-chat", group: "app",
    }));
    if (state.navigationTab === "account") return prefs.accountOrder.map(id => ({
      id, label: accountNavigationLabels[id], locked: ["settings", "logout"].includes(id), group: "account",
    }));
    const nodes = [...(state.settingsNav?.querySelectorAll("button[data-settings-panel-slug]") || [])];
    const groups = [...new Set(nodes.map(node => node.parentElement))];
    return groups.flatMap((parent, index) => nodes.filter(node => node.parentElement === parent)
      .map((node, position) => ({id: node.dataset.settingsPanelSlug,
        label: node.getAttribute("aria-label") || node.textContent.trim(),
        locked: node.dataset.settingsPanelSlug === "workflow", group: `settings-${index}`, position}))
      .sort((a, b) => (prefs.settingsOrder.indexOf(a.id) < 0 ? 100 + a.position : prefs.settingsOrder.indexOf(a.id)) -
        (prefs.settingsOrder.indexOf(b.id) < 0 ? 100 + b.position : prefs.settingsOrder.indexOf(b.id))));
  }

  // Paths and dimensions from the installed EyeOff/GripVertical/LockKeyhole assets.
  function navigationGlyph(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "icon-sm", "aria-hidden": "true"})) svg.setAttribute(key, value);
    const shapes = kind === "back" ? [["path", {d:"m15 18-6-6 6-6"}]] :
      kind === "grip" ? [9, 15].flatMap(cx => [5, 12, 19].map(cy => ["circle", {cx, cy, r: 1}])) :
      kind === "lock" ? [["circle", {cx:12,cy:16,r:1}], ["rect",{x:3,y:10,width:18,height:12,rx:2}], ["path",{d:"M7 10V7a5 5 0 0 1 10 0v3"}]] :
      kind === "hidden" ? ["M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49", "M14.084 14.158a3 3 0 0 1-4.242-4.242", "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143", "m2 2 20 20"].map(d => ["path",{d}]) :
      [["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}], ["circle",{cx:12,cy:12,r:3}]];
    for (const [tag, attrs] of shapes) {
      const node = document.createElementNS(svg.namespaceURI, tag);
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
      svg.append(node);
    }
    return svg;
  }

  function nativeSettingsGlyph() {
    const svg = navigationGlyph("eye");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.removeAttribute("stroke");
    svg.removeAttribute("stroke-width");
    const paths = [
    "M9.99944 7.24939C11.5169 7.2495 12.7473 8.47995 12.7475 9.99744C12.7475 11.5151 11.517 12.7454 9.99944 12.7455C8.48176 12.7455 7.2514 11.5151 7.2514 9.99744C7.25155 8.47988 8.48186 7.24939 9.99944 7.24939ZM9.99944 8.57947C9.2164 8.57947 8.58163 9.21442 8.58148 9.99744C8.58148 10.7806 9.2163 11.4154 9.99944 11.4154C10.7825 11.4153 11.4174 10.7805 11.4174 9.99744C11.4173 9.21449 10.7824 8.57958 9.99944 8.57947Z",
    "M10.6391 1.67517C11.2939 1.67532 11.8991 2.02577 12.226 2.59314L13.2485 4.36755H15.2963C15.9505 4.36758 16.555 4.71709 16.8823 5.28357L17.5219 6.39001C17.8489 6.95668 17.8481 7.65542 17.5209 8.22205L16.4975 9.99451L17.5239 11.7689C17.8519 12.3357 17.8521 13.0347 17.5248 13.6019L16.8862 14.7084C16.559 15.2747 15.9543 15.6243 15.3002 15.6244H13.2514L12.2299 17.3988C11.9029 17.9663 11.297 18.3168 10.642 18.3168L9.3637 18.3158C8.71064 18.3155 8.10718 17.9678 7.77972 17.4027L6.74847 15.6234L4.69964 15.6244C4.04558 15.6242 3.44087 15.2747 3.1137 14.7084L2.47503 13.6019C2.14791 13.0349 2.14836 12.3366 2.47601 11.7699L3.50237 9.99548L2.47894 8.22205C2.15175 7.65533 2.15174 6.95673 2.47894 6.39001L3.11761 5.28259C3.44458 4.71663 4.04894 4.36813 4.70257 4.36755L6.75042 4.36658L7.77581 2.59119C8.10301 2.02476 8.7076 1.67527 9.36175 1.67517H10.6391ZM9.36273 3.00623C9.1835 3.00623 9.01679 3.10199 8.92718 3.2572L7.82659 5.16345C7.63652 5.49253 7.28473 5.69529 6.90472 5.69568L4.70355 5.69763C4.52451 5.69782 4.3585 5.79355 4.26898 5.94861L3.6303 7.05505C3.54091 7.2102 3.54077 7.40192 3.6303 7.55701L4.73089 9.46326C4.92108 9.7929 4.92135 10.1992 4.73089 10.5287L3.62737 12.4359C3.5378 12.591 3.53792 12.7817 3.62737 12.9369L4.26605 14.0433C4.35567 14.1982 4.52067 14.2932 4.69964 14.2933L6.90276 14.2943C7.28242 14.2946 7.63335 14.497 7.82366 14.8256L8.93011 16.7357C9.01984 16.8905 9.18578 16.9857 9.36468 16.9857H10.642C10.8213 16.9857 10.987 16.89 11.0766 16.7347L12.1752 14.8275C12.3653 14.4975 12.7182 14.2943 13.0991 14.2943H15.3002C15.4794 14.2942 15.6452 14.1985 15.7348 14.0433L16.3725 12.9379C16.4621 12.7826 16.4621 12.5911 16.3725 12.4359L15.27 10.5287C15.1032 10.2404 15.0808 9.89331 15.2055 9.59021L15.269 9.46326L16.3696 7.55701C16.4591 7.40189 16.459 7.21022 16.3696 7.05505L15.7309 5.94861C15.6412 5.79363 15.4754 5.69863 15.2963 5.69861L13.0951 5.69763L12.9535 5.68884C12.6751 5.65158 12.4217 5.50519 12.2504 5.28259L12.1723 5.16443L11.0737 3.2572C10.9841 3.10175 10.8175 3.00525 10.6381 3.00525L9.36273 3.00623Z",
  ];
    svg.replaceChildren(...paths.map(d => {
      const path = document.createElementNS(svg.namespaceURI,"path");
      path.setAttribute("d",d); path.setAttribute("fill","currentColor");
      path.setAttribute("fill-rule","evenodd"); return path;
    }));
    return svg;
  }

  function renderNavigationPage(page) {
    const header = div("flex flex-col gap-4 pb-8");
    const back = renderActionButton("Workflow");
    back.prepend(navigationGlyph("back"));
    back.classList.remove("bg-text/5");
    back.classList.add("self-start");
    back.addEventListener("click", () => { state.page = "home"; redrawWorkflowPanel(); });
    const title = document.createElement("h1");
    title.className = "min-w-0 break-words text-default heading-lg font-normal";
    title.tabIndex = -1;
    title.textContent = "Sidebar & navigation";
    const description = div("text-base text-secondary text-balance");
    description.textContent = "Choose what appears and arrange it your way.";
    header.append(back, title, description);
    const tabs = div("-ms-2 flex min-w-0 items-center gap-2 hide-scrollbar overflow-x-auto overflow-y-hidden");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Navigation area");
    for (const [id, label] of [["app", "App sidebar"], ["settings", "Settings navigation"], ["account", "Account menu"]]) {
      const button = document.createElement("button");
      button.type = "button";
      const selected = state.navigationTab === id;
      button.className = `${segmentClass} ${selected ? "bg-surface-secondary text-default" : "text-secondary hover:bg-surface-secondary"}`;
      button.setAttribute("aria-pressed", String(selected));
      button.textContent = label;
      button.addEventListener("click", () => { state.navigationTab = id; redrawWorkflowPanel(); });
      tabs.append(button);
    }
    header.append(tabs);
    const section = sectionHeading("Navigation items");
    const card = settingsCard();
    card.dataset.codexWorkflowNavigationRows = "true";
    section.append(card);
    page.append(header, section);
    populateNavigationRows(card);
    if (state.navigationTab === "app") {
      const layout = sectionHeading("Layout");
      layout.classList.add("mt-8");
      const layoutCard = settingsCard();
      const row = div("flex items-center justify-between px-4 gap-6 py-3");
      const copy = div("flex min-w-0 flex-1 flex-col gap-0.5");
      const label = div("min-w-0 text-sm text-default font-medium");
      label.textContent = "Sidebar width";
      const detail = div("min-w-0 text-xs leading-4 text-balance text-secondary");
      detail.textContent = "Set the width precisely, or drag the sidebar edge.";
      copy.append(label, detail);
      const controls = div("flex shrink-0 items-center gap-2");
      const wrapper = div("relative w-24");
      const input = document.createElement("input");
      input.type = "text"; input.inputMode = "numeric";
      input.setAttribute("aria-label", "Sidebar width");
      input.className = "w-full min-w-0 border text-default outline-none placeholder:text-tertiary aria-invalid:border-text-danger aria-invalid:ring-2 aria-invalid:ring-text-danger/20 disabled:cursor-not-allowed disabled:text-secondary h-7 rounded-md bg-primary-soft px-2 text-sm border-primary-outline focus:border-ring disabled:bg-text/5 tabular-nums";
      // Native numeric field and unit, sharing the same field boundary.
      input.style.paddingInlineEnd = "calc(var(--spacing, 4px) * 8)";
      let savedWidth;
      state.widthInput = input;
      input.disabled = true;
      ipcRenderer.invoke("codex-workflow:sidebar-width", {action:"get"}).then(width => {
        if (state.widthInput !== input) return;
        savedWidth = width; input.value = String(width); input.disabled = !state.settings.focusedInterface;
      }).catch(() => { if (state.status) state.status.textContent = "Open the app sidebar to adjust its width."; });
      input.addEventListener("change", async () => {
        const width = Number(input.value);
        if (!input.value.trim() || !Number.isInteger(width) || width < 240 || width > 520) {
          input.setAttribute("aria-invalid", "true");
          if (state.status) state.status.textContent = "Enter a width from 240 to 520 px.";
          return;
        }
        input.removeAttribute("aria-invalid"); input.disabled = true;
        try { savedWidth = await ipcRenderer.invoke("codex-workflow:sidebar-width", {action:"set", width: Number(input.value)}); input.value = String(savedWidth); }
        catch (error) { input.value = String(savedWidth); if (state.status) state.status.textContent = "Couldn’t resize the sidebar. Please try again."; }
        finally { input.disabled = !state.settings.focusedInterface; }
      });
      const unit = div("pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-secondary"); unit.textContent = "px";
      unit.setAttribute("aria-hidden", "true");
      input.setAttribute("aria-description", "Width in pixels, from 240 to 520.");
      wrapper.append(input, unit);
      controls.append(wrapper); row.append(copy, controls);
      const recent = renderSettingRow({key:"showRecentChats", label:"Show recent chats", description:"Keep recently opened chats below your projects."});
      const recentControl = state.settingControls.get("showRecentChats");
      state.settingControls.delete("showRecentChats");
      recentControl.apply(state.settings.sidebarNavigation.showRecentChats);
      // Replace the generic handler with the same switch bound to this nested preference.
      const button = recentControl.button.cloneNode(true);
      recentControl.button.replaceWith(button);
      button.addEventListener("click", () => navigationUpdate({showRecentChats: !state.settings.sidebarNavigation.showRecentChats}));
      button.dataset.codexWorkflowRecentSwitch = "true";
      state.navigationControls.push(button);
      layoutCard.append(row, recent); layout.append(layoutCard); page.append(layout);
    }
    const footer = div("mt-8 flex flex-wrap items-center justify-between gap-4");
    state.status = div("text-xs leading-4 text-secondary");
    state.status.setAttribute("role", "status");
    const reset = renderActionButton("Reset this section", true);
    reset.addEventListener("click", () => navigationUpdate({...defaults.sidebarNavigation}));
    state.navigationControls.push(reset);
    footer.append(state.status, reset); page.append(footer);
    refreshSettingControls();
  }

  function populateNavigationRows(card) {
    const existing = new Map([...card.children].map(row => [row.dataset.workflowNavigationItem, row]));
    const [, hiddenKey] = navigationKeys();
    const rows = [];
    for (const item of navigationItems()) {
      const hidden = state.settings.sidebarNavigation[hiddenKey].includes(item.id);
      const previous = existing.get(item.id);
      if (previous?.dataset.workflowNavigationHidden === String(hidden)) {
        rows.push(previous);
        state.navigationControls.push(...previous.querySelectorAll("button:not([data-workflow-locked])"));
        continue;
      }
      const row = div("flex items-center justify-between px-4 gap-6 py-3");
      row.dataset.workflowNavigationItem = item.id;
      row.dataset.workflowNavigationGroup = item.group;
      row.dataset.workflowNavigationHidden = String(hidden);
      const left = div("flex min-w-0 items-center gap-3 flex-1");
      const handle = document.createElement("button");
      handle.type = "button"; handle.className = iconButtonClass;
      handle.append(navigationGlyph("grip"));
      handle.setAttribute("aria-label", `Reorder ${item.label}. Use arrow keys to move.`);
      handle.disabled = item.locked;
      if (item.locked) handle.dataset.workflowLocked = "true";
      else {
        handle.style.touchAction = "none";
        handle.style.cursor = "grab";
        handle.addEventListener("pointerdown", event => beginNavigationDrag(event, item, row, card));
      }
      handle.addEventListener("keydown", event => {
        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const items = navigationItems().filter(x => !x.locked && x.group === item.group);
        const target = items[items.findIndex(x => x.id === item.id) + (event.key === "ArrowUp" ? -1 : 1)];
        if (target) moveNavigationItem(item, target);
      });
      if (!item.locked) state.navigationControls.push(handle);
      left.append(handle);
      const icon = state.icons.get(`${state.navigationTab}:${item.id}`);
      if (icon) { const clone = icon.cloneNode(true); scrubSidebarClone(clone); left.append(clone); }
      const label = div("min-w-0 text-sm text-default font-medium"); label.textContent = item.label; left.append(label);
      const controls = div("flex shrink-0 items-center gap-2 text-xs text-secondary");
      if (item.locked) {
        const copy = div("text-xs text-secondary"); copy.textContent = "Always visible";
        controls.append(navigationGlyph("lock"), copy);
      } else {
        const eye = document.createElement("button"); eye.type = "button"; eye.className = iconButtonClass;
        eye.setAttribute("aria-label", `${hidden ? "Show" : "Hide"} ${item.label}`);
        eye.title = `${hidden ? "Show" : "Hide"} ${item.label}`;
        eye.setAttribute("aria-pressed", String(!hidden));
        eye.append(navigationGlyph(hidden ? "hidden" : "eye"));
        eye.addEventListener("click", () => {
          const hiddenIds = state.settings.sidebarNavigation[hiddenKey];
          navigationUpdate({[hiddenKey]: hidden ? hiddenIds.filter(id => id !== item.id) : [...hiddenIds, item.id]});
        });
        state.navigationControls.push(eye);
        if (hidden) { const copy = div("text-xs text-secondary"); copy.textContent = "Hidden"; controls.append(copy); }
        controls.append(eye);
      }
      row.append(left, controls); rows.push(row);
    }
    for (const row of [...card.children]) if (!rows.includes(row)) row.remove();
    rows.forEach((row, index) => { if (card.children[index] !== row) card.insertBefore(row, card.children[index] || null); });
  }

  // Native sortable defaults: 200ms/ease for displaced rows, 250ms/ease on drop
  // (XVa/yAe in the audited app-initial bundle). Read presentation positions so
  // another swap can interrupt an unfinished one without snapping.
  function animateNavigationRows(card, before, duration = 200, excluded = null) {
    const nativeMotion = document.documentElement.dataset.reducedMotion;
    const reduceMotion = nativeMotion === undefined ? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches : nativeMotion === "true";
    for (const row of card.children) {
      if (row === excluded) continue;
      const top = before.get(row.dataset.workflowNavigationItem);
      row.getAnimations?.().forEach(animation => animation.cancel());
      const delta = top === undefined ? 0 : top - row.getBoundingClientRect().top;
      if (delta && !reduceMotion) {
        row.animate?.([{transform:`translateY(${delta}px)`}, {transform:"translateY(0)"}], {duration, easing:"ease"});
      }
    }
  }

  function navigationPositions(card) {
    return new Map([...card.children].map(row => [row.dataset.workflowNavigationItem, row.getBoundingClientRect().top]));
  }

  function beginNavigationDrag(event, item, row, card) {
    if (event.button !== 0 || item.locked || state.settingsWriteInFlight || state.drag) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.focus({preventScroll:true});
    // Capture on the stationary card: moving a captured row loses capture.
    card.setPointerCapture(event.pointerId);
    const rect = row.getBoundingClientRect();
    row.getAnimations?.().forEach(animation => animation.cancel());
    const scroller = card.closest(".overflow-y-auto");
    const startScroll = scroller?.scrollTop || 0;
    const items = navigationItems().filter(other => !other.locked && other.group === item.group);
    const slots = items.map(other => card.querySelector(`[data-workflow-navigation-item="${other.id}"]`).getBoundingClientRect().top);
    const original = [...card.children];
    let moved = false, translation = 0;
    state.drag = {cancel: () => finish(false)};
    row.style.position = "relative"; row.style.zIndex = "1";
    row.classList.add("bg-surface", "rounded-lg", "shadow-lg");
    handle.style.cursor = "grabbing";
    const move = next => {
      if (next.pointerId !== event.pointerId) return;
      const dy = next.clientY - event.clientY;
      if (!moved && Math.abs(dy) < 4) return;
      moved = true;
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const edge = rect.height;
        if (next.clientY < bounds.top + edge) scroller.scrollTop -= (bounds.top + edge - next.clientY) / 4;
        else if (next.clientY > bounds.bottom - edge) scroller.scrollTop += (next.clientY - bounds.bottom + edge) / 4;
      }
      const scroll = (scroller?.scrollTop || 0) - startScroll;
      const desired = Math.max(slots[0], Math.min(slots.at(-1), rect.top + dy + scroll));
      const index = slots.reduce((best, top, i) => Math.abs(top - desired) < Math.abs(slots[best] - desired) ? i : best, 0);
      const peers = [...card.children].filter(node => items.some(other => other.id === node.dataset.workflowNavigationItem));
      const current = peers.indexOf(row);
      if (index !== current) {
        const before = navigationPositions(card);
        card.insertBefore(row, index > current ? peers[index].nextSibling : peers[index]);
        animateNavigationRows(card, before, 200, row);
      }
      const layoutTop = row.getBoundingClientRect().top - translation;
      translation = desired - scroll - layoutTop;
      row.style.transform = `translateY(${translation}px)`;
    };
    const finish = commit => {
      if (!state.drag) return;
      state.drag = null;
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", cancel);
      card.removeEventListener("lostpointercapture", cancel);
      document.removeEventListener("keydown", escape, true);
      if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
      const before = navigationPositions(card);
      row.style.transform = ""; row.style.position = ""; row.style.zIndex = "";
      row.classList.remove("bg-surface", "rounded-lg", "shadow-lg");
      handle.style.cursor = "grab";
      if (!commit) original.forEach((node, index) => { if (card.children[index] !== node) card.insertBefore(node, card.children[index] || null); });
      animateNavigationRows(card, before, 250);
      if (commit && moved) {
        const order = [...card.children].map(node => node.dataset.workflowNavigationItem).filter(id => id !== "new-chat");
        const [key] = navigationKeys();
        navigationUpdate({[key]:order});
      }
    };
    const up = next => { if (next.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish(false);
    const escape = next => { if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); finish(false); } };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", cancel);
    card.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", escape, true);
  }

  async function moveNavigationItem(from, to) {
    if (from.id === to.id || from.locked || to.locked || state.settingsWriteInFlight) return;
    const [key] = navigationKeys();
    const order = navigationItems().filter(item => item.id !== "new-chat").map(item => item.id);
    const source = order.indexOf(from.id), target = order.indexOf(to.id);
    order.splice(source, 1); order.splice(target, 0, from.id);
    await navigationUpdate({[key]:order});
    state.panel?.querySelector(`[data-workflow-navigation-item="${from.id}"] button`)?.focus();
  }

  function refreshNavigationRows() {
    const focus = document.activeElement;
    const id = focus?.closest?.("[data-workflow-navigation-item]")?.dataset.workflowNavigationItem;
    const eye = focus?.hasAttribute?.("aria-pressed");
    const card = state.panel?.querySelector("[data-codex-workflow-navigation-rows]");
    if (!card) return;
    const before = navigationPositions(card);
    state.navigationControls = state.navigationControls.filter(node => node.isConnected && !card.contains(node));
    populateNavigationRows(card);
    // Unchanged keyed rows retain their in-flight drop animation.
    if ([...card.children].some(row => before.get(row.dataset.workflowNavigationItem) !== row.getBoundingClientRect().top && !row.getAnimations?.().length)) {
      animateNavigationRows(card, before);
    }
    const recent = state.panel.querySelector("[data-codex-workflow-recent-switch]");
    if (recent) {
      const checked = state.settings.sidebarNavigation.showRecentChats;
      recent.setAttribute("aria-checked", String(checked));
      for (const node of [recent, ...recent.querySelectorAll("[data-state]")]) node.dataset.state = checked ? "checked" : "unchecked";
      recent.firstElementChild.classList.toggle("bg-chart-blue", checked);
      recent.firstElementChild.classList.toggle("bg-text/10", !checked);
    }
    refreshSettingControls();
    if (id) state.panel.querySelector(`[data-workflow-navigation-item="${id}"] ${eye ? "button[aria-pressed]" : "button"}`)?.focus();
  }

  function markNavigation(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  function followVisibleNavigationOrder(event) {
    if (!state.settings.focusedInterface || event.metaKey || event.ctrlKey || event.altKey) return;
    const visible = node => !node.disabled && !node.closest('[inert]') && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== "hidden";
    const visualOrder = (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
      a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    const menu = event.target.closest?.('[role="menu"][data-workflow-account-menu]');
    if (menu && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(visible).sort(visualOrder);
      const current = items.indexOf(document.activeElement);
      const next = event.key === "Home" ? items[0] : event.key === "End" ? items.at(-1) :
        items[(current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length];
      if (next) { event.preventDefault(); event.stopPropagation(); next.focus(); }
    } else if (event.key === "Tab" && !menu) {
      const panel = document.querySelector('.app-shell-left-panel');
      if (!panel) return;
      const targets = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
        .filter(node => node.tabIndex >= 0 && visible(node));
      const sidebar = targets.filter(node => panel.contains(node)).sort(visualOrder);
      let index = 0;
      const ordered = targets.map(node => panel.contains(node) ? sidebar[index++] : node);
      const current = ordered.indexOf(document.activeElement);
      const next = ordered[current + (event.shiftKey ? -1 : 1)];
      const nativeNext = targets[targets.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1)];
      if (current >= 0 && next && next !== nativeNext) { event.preventDefault(); next.focus(); }
    }
  }

  function rememberIcon(area, id, node) {
    const icon = node?.querySelector("svg");
    if (icon) state.icons.set(`${area}:${id}`, icon.cloneNode(true));
  }

  function syncNavigation() {
    if (!document?.documentElement) return;
    const prefs = state.settings.sidebarNavigation;
    const enabled = state.settings.focusedInterface;
    const scope = 'aside.app-shell-left-panel #app-shell-sidebar';
    const rules = enabled ? [`${scope} [data-workflow-nav-flatten]{display:contents!important;}`] : [];
    if (enabled) {
      // Build 7982: even the native width token can differ from the rendered sidebar.
      rules.push('[role="menu"][data-workflow-account-sizing]{width:calc(var(--codex-workflow-account-sidebar-width) - 2 * var(--padding-row-cell-x, var(--padding-row-x)))!important;}');
      prefs.order.forEach((id, index) => rules.push(`${scope} [data-workflow-native-nav="${id}"]{order:${index + 1}!important;}`));
      prefs.hidden.forEach(id => rules.push(`${scope} [data-workflow-native-nav="${id}"]{display:none!important;}`));
      if (!prefs.showRecentChats) rules.push(`${scope} section[data-app-action-sidebar-section-heading="Recents"]{display:none!important;}`);
      const settingsScope = '.app-shell-left-panel > nav.sidebar-navigation[aria-label="Settings"]:not([role="dialog"] *, [role="menu"] *, [cmdk-root] *)';
      prefs.settingsHidden.forEach(id => rules.push(`${settingsScope} button[data-settings-panel-slug="${id}"]:not(:disabled){display:none!important;}`));
      if (prefs.settingsHidden.length) {
        const visible = prefs.settingsHidden.map(id => `:not([data-settings-panel-slug="${id}"])`).join("");
        rules.push(`${settingsScope} .flex.flex-col.gap-1:has(> .group\\/nav-section-title):has(> .flex.flex-col > button[data-settings-panel-slug]):not(:has(> .flex.flex-col > button${visible})):not(:has(.group\\/nav-section-title button)){display:none!important;}`);
      }
      // The native Account entry is a span-wrapped button without a panel slug.
      // Preserve it after the sortable entries instead of letting order:0 lift it.
      if (prefs.settingsOrder.length) rules.push(`${settingsScope} :where(.flex.flex-col:has(> button[data-settings-panel-slug]) > *, .contents > button.sidebar-item:not([data-settings-panel-slug])){order:101!important;}`);
      prefs.settingsOrder.forEach((id,index) => rules.push(`${settingsScope} button[data-settings-panel-slug="${id}"]{order:${index + 1}!important;}`));
      prefs.accountHidden.forEach(id => rules.push(`[role="menu"][data-workflow-account-menu] [data-workflow-account-item="${id}"]{display:none!important;}`));
      prefs.accountOrder.forEach((id,index) => {
        rules.push(`[role="menu"][data-workflow-account-menu] [data-workflow-account-item="${id}"]{order:${index + 1}!important;}`);
        rules.push(`[role="menu"][data-workflow-account-menu] [data-workflow-account-separator="${id}"]{order:${index + 1.5}!important;}`);
      });
    }
    if (!state.navigationStyle) { state.navigationStyle = document.createElement("style"); state.navigationStyle.dataset.codexWorkflowNavigationStyle = "true"; document.documentElement.append(state.navigationStyle); }
    const css = rules.join("\n");
    const activeSettings = document.activeElement?.closest?.("[data-settings-panel-slug]");
    if (enabled && prefs.settingsHidden.includes(activeSettings?.dataset.settingsPanelSlug)) state.customNav?.focus();
    if (state.navigationStyle.textContent !== css) state.navigationStyle.textContent = css;
    const roots = [...document.querySelectorAll("#app-shell-sidebar")].filter(node => node.closest("aside.app-shell-left-panel"));
    const root = roots.length === 1 ? roots[0] : null;
    if (root !== state.navigationRoot) {
      state.navigationObserver?.disconnect();
      state.navigationMountObservers.forEach(observer => observer.disconnect());
      state.navigationMountObservers = [];
      state.navigationRoot = root;
      if (root) {
        state.navigationObserver = new MutationObserver(syncNavigation);
        state.navigationObserver.observe(root, {childList:true, subtree:true});
        let child = root;
        while (child?.parentElement) {
          const observer = new MutationObserver(() => { if (!root.isConnected) { syncNavigation(); beginDiscovery(); } });
          observer.observe(child.parentElement, {childList:true}); state.navigationMountObservers.push(observer);
          if (child.parentElement === document.body) break;
          child = child.parentElement;
        }
      }
    }
    if (root) {
      const native = [...root.querySelectorAll("button.sidebar-item")].filter(node => !node.closest('[role="menu"], section, [data-workflow-shortcut]'));
      const rows = new Map();
      for (const [id,label] of Object.entries(appNavigationLabels)) {
        const matches = native.filter(node => node.querySelector(".text-fade-truncate")?.textContent.trim() === label);
        if (matches.length !== 1) continue;
        rows.set(id,matches[0]); rememberIcon("app",id,matches[0]);
      }
      const group = rows.get("explore")?.parentElement;
      if (group && ["pull-requests","scheduled","plugins"].every(id => rows.get(id) && group.contains(rows.get(id)))) {
        for (const [id,node] of rows) {
          if (id === "new-chat") continue;
          markNavigation(node,"data-workflow-native-nav",id);
          let parent = node.parentElement;
          while (parent && parent !== group) { markNavigation(parent,"data-workflow-nav-flatten","true"); parent = parent.parentElement; }
        }
        let shortcut = group.querySelector("[data-workflow-shortcut]");
        if (enabled && !shortcut) {
          shortcut = rows.get("pull-requests").cloneNode(true); scrubSidebarClone(shortcut);
          shortcut.dataset.workflowShortcut = "true"; shortcut.dataset.workflowNativeNav = "settings-shortcut";
          replaceLabelText(shortcut,"Settings"); shortcut.setAttribute("aria-label","Settings");
          const gear = nativeSettingsGlyph();
          shortcut.querySelector("svg")?.replaceWith(gear);
          state.icons.set("app:settings-shortcut",gear.cloneNode(true));
          shortcut.addEventListener("click", () => { beginDiscovery(); ipcRenderer.invoke("codex-workflow:settings:activate",{target:"keyboard-shortcut"}).catch(error => log("error",error.message)); });
          group.append(shortcut);
        }
        if (!enabled) shortcut?.remove();
      }
      const active = document.activeElement;
      if (root.contains(active) && getComputedStyle(active).display === "none") rows.get("new-chat")?.focus();
      const recent = root.querySelector('section[data-app-action-sidebar-section-heading="Recents"]');
      if (enabled && !prefs.showRecentChats && recent?.contains(active)) rows.get("new-chat")?.focus();
    }
    for (const node of document.querySelectorAll('nav[aria-label="Settings"] button[data-settings-panel-slug]')) {
      rememberIcon("settings",node.dataset.settingsPanelSlug,node);
    }
    syncAccountNavigation();
  }

  function syncAccountNavigation() {
    if (!document?.documentElement) return;
    const matches = [...document.querySelectorAll('[role="menu"]')].filter(menu =>
      [...menu.querySelectorAll('[role="menuitem"]')].some(node => node.querySelector("span.truncate, span.min-w-0")?.textContent === "Settings"));
    syncAccountSizing(matches.length === 1 ? matches[0] : null);
    if (matches.length !== 1) return;
    const menu = matches[0]; markNavigation(menu,"data-workflow-account-menu","true");
    for (const [id,label] of Object.entries(accountNavigationLabels)) {
      const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(node =>
        [...node.querySelectorAll("span")].some(span => span.textContent === label || (id === "pet" && span.textContent === "Hide pet")));
      if (items.length !== 1) continue;
      markNavigation(items[0],"data-workflow-account-item",id); rememberIcon("account",id,items[0]);
      if (state.settings.focusedInterface && state.settings.sidebarNavigation.accountHidden.includes(id) && items[0].contains(document.activeElement)) menu.focus();
    }
    const parent = menu.querySelector('[data-workflow-account-item]')?.parentElement;
    let previous = null;
    for (const child of parent?.children || []) {
      if (child.hasAttribute("data-workflow-account-item")) previous = child.dataset.workflowAccountItem;
      else if (previous && child.matches("div.w-full") && child.querySelector(".h-px.bg-border")) markNavigation(child,"data-workflow-account-separator",previous);
    }
  }

  function syncAccountSizing(menu) {
    const trigger = menu && document.getElementById(menu.getAttribute("aria-labelledby"));
    const sidebar = trigger?.matches('button[aria-label="Open profile menu"]') && trigger.closest('.app-shell-left-panel');
    if (!state.settings.focusedInterface || !sidebar) menu = null;
    if (state.accountSizing?.menu === menu && state.accountSizing?.sidebar === sidebar) {
      state.accountSizing.update();
      return;
    }
    state.accountSizing?.release();
    if (!menu) return;
    const property = '--codex-workflow-account-sidebar-width';
    const original = menu.style.getPropertyValue(property);
    const priority = menu.style.getPropertyPriority(property);
    const release = () => {
      observer?.disconnect();
      menu.removeAttribute('data-workflow-account-sizing');
      if (original) menu.style.setProperty(property, original, priority);
      else menu.style.removeProperty(property);
      state.accountSizing = null;
    };
    const update = () => {
      if (!menu.isConnected || !sidebar.isConnected) { release(); return; }
      // Preserve the native minimum while the responsive sidebar animates closed.
      const width = `${Math.max(240, sidebar.getBoundingClientRect().width)}px`;
      if (menu.style.getPropertyValue(property) !== width) menu.style.setProperty(property, width);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    state.accountSizing = {menu, sidebar, update, release};
    markNavigation(menu, 'data-workflow-account-sizing', 'true');
    update();
    observer?.observe(sidebar);
    observer?.observe(menu);
  }

  function syncSettingsPage() {
    const shell = state.settingsShell;
    if (!shell?.isConnected) {
      if (shell) releaseShell();
      beginDiscovery();
      return;
    }
    const nav = findSettingsNav(shell);
    if (!nav) {
      if (state.settingsNav) releaseSettingsMount();
      return;
    }

    if (state.settingsNav && state.settingsNav !== nav) releaseSettingsMount();
    state.settingsNav = nav;
    if (state.navWithListener !== nav) {
      nav.addEventListener("click", onSettingsNavClick, true);
      state.navWithListener = nav;
    }

    let custom = nav.querySelector('[data-codex-workflow="nav-item"]');
    if (!(custom instanceof HTMLElement)) {
      custom = createWorkflowNavItem(nav);
    }
    if (!custom) return;
    state.customNav = custom;

    if (state.activeWorkflow) {
      const nativeActive = Array.from(nav.querySelectorAll('[data-settings-panel-slug][aria-current="page"]'))
        .find((item) => item !== custom);
      const activeSlug = nativeActive?.getAttribute("data-settings-panel-slug") || null;
      if (
        (state.workflowEntryLocation && location.href !== state.workflowEntryLocation) ||
        (state.workflowNativeSlug && activeSlug && activeSlug !== state.workflowNativeSlug)
      ) {
        restoreNativeSettingsView();
        return;
      }
      activateWorkflowPanel();
    }
  }

  function findSettingsNav(scope = document) {
    const candidates = new Set(scope.querySelectorAll('nav[aria-label="Settings"]'));
    if (scope instanceof Element && scope.matches('nav[aria-label="Settings"]')) candidates.add(scope);
    for (const general of scope.querySelectorAll('[data-settings-panel-slug="general-settings"]')) {
      const nav = general.closest("nav");
      if (nav) candidates.add(nav);
    }
    const matches = Array.from(candidates).filter(isSettingsNav);
    return matches.length === 1 ? matches[0] : null;
  }

  function isSettingsNav(nav) {
    if (!(nav instanceof HTMLElement) || !nav.isConnected) return false;
    if (nav.closest('[role="dialog"], [role="menu"], [cmdk-root], .vertical-scroll-fade-mask')) return false;
    const style = getComputedStyle(nav);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = nav.getBoundingClientRect();
    if (rect.width < 100 || rect.width > 380 || rect.height < 180 || rect.left > innerWidth / 2) return false;
    if (nav === state.settingsNav) return true;
    const slugs = new Set(
      Array.from(nav.querySelectorAll("[data-settings-panel-slug]"))
        .map((item) => item.getAttribute("data-settings-panel-slug")),
    );
    return ["general-settings", "appearance", "voice", "personalization"]
      .filter((slug) => slugs.has(slug)).length >= 2 && slugs.size >= 4;
  }

  function createWorkflowNavItem(nav) {
    const appearance = nav.querySelector('[data-settings-panel-slug="appearance"]');
    const nativeItems = Array.from(nav.querySelectorAll("[data-settings-panel-slug]"));
    const source = nativeItems.find((item) => item.getAttribute("aria-current") !== "page") || appearance || nativeItems[0] || state.customNav;
    if (!(source instanceof HTMLElement)) return null;

    const item = source.cloneNode(true);
    if (!(item instanceof HTMLElement)) return null;
    scrubSidebarClone(item);
    if (source === state.customNav) applyVisualTemplate(item, state.customInactiveSnapshot);
    item.setAttribute("data-settings-panel-slug", "workflow");
    item.dataset.codexWorkflow = "nav-item";
    item.setAttribute("aria-label", "Workflow");
    item.removeAttribute("id");
    item.removeAttribute("aria-current");
    item.removeAttribute("data-state");
    replaceLabelText(item, "Workflow");
    replaceNavIcon(item);
    state.customInactiveSnapshot = snapshotVisualState(item);
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      const nativeActive = Array.from(nav.querySelectorAll('[data-settings-panel-slug][aria-current="page"]'))
        .find((entry) => entry !== item);
      state.workflowEntryLocation = location.href;
      state.workflowNativeSlug = nativeActive?.getAttribute("data-settings-panel-slug") || null;
      state.activeWorkflow = true;
      activateWorkflowPanel();
    }, true);

    if (appearance?.parentElement) {
      appearance.insertAdjacentElement("afterend", item);
    } else {
      (nav.querySelector(".overflow-y-auto") || source.parentElement)?.appendChild(item);
    }

    if (!state.loggedSettingsShell) {
      state.loggedSettingsShell = true;
      log("info", `Settings shell found with ${nativeItems.length} native entries`);
    }
    return item;
  }

  function replaceLabelText(root, replacement) {
    const visibleLabel = root.querySelector(".text-fade-truncate, [class*='truncate']");
    if (visibleLabel) {
      visibleLabel.textContent = replacement;
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (compactText(walker.currentNode.nodeValue)) {
        walker.currentNode.nodeValue = replacement;
        return;
      }
    }
  }

  function replaceNavIcon(root) {
    const svg = root.querySelector("svg");
    if (!svg) return;
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("fill", "none");
    svg.replaceChildren();
    const pathA = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathA.setAttribute("d", "M3 5h8M14 5h3M3 10h3M9 10h8M3 15h10M16 15h1");
    pathA.setAttribute("stroke", "currentColor");
    pathA.setAttribute("stroke-width", "1.5");
    pathA.setAttribute("stroke-linecap", "round");
    const pathB = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathB.setAttribute("d", "M12.5 3.5v3M7.5 8.5v3M14.5 13.5v3");
    pathB.setAttribute("stroke", "currentColor");
    pathB.setAttribute("stroke-width", "1.5");
    pathB.setAttribute("stroke-linecap", "round");
    svg.append(pathA, pathB);
  }

  function onSettingsNavClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest("[data-settings-panel-slug], [data-list-navigation-item], [data-codex-workflow='nav-item']");
    if (!item || item === state.customNav) return;
    if (state.activeWorkflow) restoreNativeSettingsView();
    queueMicrotask(() => scheduleWork("settings"));
  }

  function findContentArea(nav) {
    let parent = nav.parentElement;
    while (parent) {
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child === nav || child.contains(nav)) continue;
        const rect = child.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 200) return child;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function findSettingsShell() {
    const nav = findSettingsNav(document);
    if (!nav) return null;
    let parent = nav.parentElement;
    while (parent && parent !== document.documentElement) {
      const hasContentSibling = Array.from(parent.children).some((child) => {
        if (!(child instanceof HTMLElement) || child === nav || child.contains(nav)) return false;
        const rect = child.getBoundingClientRect();
        return rect.width > 300 && rect.height > 200;
      });
      if (hasContentSibling) return parent;
      parent = parent.parentElement;
    }
    return nav.parentElement;
  }

  function settingsCard() {
    const card = div("flex flex-col [&>*:not(:last-child)]:relative [&>*:not(:last-child)]:after:pointer-events-none [&>*:not(:last-child)]:after:absolute [&>*:not(:last-child)]:after:inset-x-4 [&>*:not(:last-child)]:after:bottom-0 [&>*:not(:last-child)]:after:h-[0.5px] [&>*:not(:last-child)]:after:bg-border [&>*:not(:last-child)]:after:content-[''] rounded-2xl overflow-hidden border border-default");
    card.style.backgroundColor = "var(--color-background-panel, var(--color-background-primary-soft-alpha))";
    return card;
  }

  function renderSettingRow({ key, label: labelText, description: descriptionText, requiresFocusedInterface = false }) {
    const row = div("flex items-center justify-between px-4 gap-6 py-3");
    const left = div("flex min-w-0 items-center gap-3 flex-1");
    const stack = div("flex min-w-0 flex-1 flex-col gap-0.5");
    const label = div("min-w-0 text-sm text-default font-medium");
    label.id = `codex-workflow-${key}-label`;
    label.textContent = labelText;
    const description = div("min-w-0 text-xs leading-4 text-balance text-secondary");
    description.id = `codex-workflow-${key}-description`;
    description.textContent = descriptionText;
    stack.append(label, description);
    left.appendChild(stack);

    const control = div("flex max-w-full shrink-0 items-center gap-2");
    control.appendChild(renderSwitch({
      key,
      labelId: label.id,
      descriptionId: description.id,
      requiresFocusedInterface,
    }));
    row.append(left, control);
    return row;
  }

  function renderSwitch({ key, labelId, descriptionId, requiresFocusedInterface }) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-labelledby", labelId);
    button.setAttribute("aria-describedby", descriptionId);
    button.className = "inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-full cursor-interaction";

    const track = document.createElement("span");
    track.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("span");
    thumb.className = "rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] shadow-sm transition-transform duration-basic ease-out data-[state=unchecked]:translate-x-0 h-4 w-4 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[14px] rtl:data-[state=unchecked]:-translate-x-[2px] rtl:data-[state=checked]:-translate-x-[14px]";
    track.appendChild(thumb);
    button.appendChild(track);

    const apply = (checked) => {
      const value = checked ? "checked" : "unchecked";
      button.setAttribute("aria-checked", String(checked));
      button.dataset.state = value;
      track.dataset.state = value;
      thumb.dataset.state = value;
      track.className = `relative inline-flex shrink-0 items-center rounded-full transition-colors duration-basic ease-out h-5 w-8 ${checked ? "bg-chart-blue" : "bg-text/10"}`;
    };
    const applyDisabled = (disabled) => {
      button.disabled = disabled;
      button.classList.toggle("cursor-interaction", !disabled);
      button.classList.toggle("cursor-not-allowed", disabled);
      button.classList.toggle("opacity-60", disabled);
    };
    const control = { button, apply, applyDisabled, requiresFocusedInterface };
    state.settingControls.set(key, control);
    apply(state.settings[key]);
    applyDisabled(
      state.settingsWriteInFlight ||
      (requiresFocusedInterface && !state.settings.focusedInterface),
    );

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled || state.settingsWriteInFlight) return;
      await persistSetting(key, !state.settings[key]);
    });
    return button;
  }

  function renderActionButton(label, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    const variant = danger ? "text-chart-red enabled:hover:bg-chart-red/10" : "text-default bg-text/5 enabled:hover:bg-text/10 data-[state=open]:bg-text/10";
    button.className = `no-drag cursor-interaction items-center gap-1 border whitespace-nowrap select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-40 flex rounded-md ${variant} border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px]`;
    return button;
  }

  function scrubSidebarClone(root) {
    for (const element of [root, ...root.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name === "id" || attribute.name === "href" ||
          attribute.name === "tabindex" || attribute.name === "title" ||
          attribute.name === "name" || attribute.name === "value" ||
          attribute.name === "for" || attribute.name.startsWith("data-") ||
          ["aria-controls", "aria-owns", "aria-labelledby", "aria-describedby"].includes(attribute.name)) {
          element.removeAttribute(attribute.name);
        }
      }
    }
  }

  function snapshotVisualState(root) {
    return [root, ...root.querySelectorAll("*")].map((element) => ({
      element,
      className: element.getAttribute("class"),
      ariaCurrent: element.getAttribute("aria-current"),
    }));
  }

  function restoreVisualState(snapshot) {
    for (const entry of snapshot || []) {
      if (!entry.element.isConnected) continue;
      if (entry.className == null) entry.element.removeAttribute("class");
      else entry.element.setAttribute("class", entry.className);
      if (entry.ariaCurrent == null) entry.element.removeAttribute("aria-current");
      else entry.element.setAttribute("aria-current", entry.ariaCurrent);
    }
  }

  function applyVisualTemplate(root, snapshot) {
    const template = (snapshot || []).filter(isTemplateElement);
    const targets = [root, ...root.querySelectorAll("*")].filter(isTemplateElement);
    for (let index = 0; index < Math.min(template.length, targets.length); index += 1) {
      const source = template[index];
      const target = targets[index];
      if (source.className == null) target.removeAttribute("class");
      else target.setAttribute("class", source.className);
      if (source.ariaCurrent == null) target.removeAttribute("aria-current");
      else target.setAttribute("aria-current", source.ariaCurrent);
    }
  }

  function isTemplateElement(entry) {
    const element = entry?.element || entry;
    if (!(element instanceof Element)) return false;
    return !(element instanceof SVGElement) || element.tagName.toLocaleLowerCase() === "svg";
  }

  function muteNativeActiveNav(nav) {
    if (state.nativeSnapshot?.every((entry) => entry.element.isConnected && nav.contains(entry.element))) return;
    state.nativeSnapshot = null;
    const active = Array.from(nav.querySelectorAll("[data-settings-panel-slug]"))
      .find((item) => item !== state.customNav && item.getAttribute("aria-current") === "page");
    if (!(active instanceof HTMLElement)) return;
    state.nativeSnapshot = snapshotVisualState(active);
    applyVisualTemplate(active, state.customInactiveSnapshot);
    if (state.customNav) applyVisualTemplate(state.customNav, state.nativeSnapshot);
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  }

  function div(className) {
    const element = document.createElement("div");
    element.className = className;
    return element;
  }

  function log(level, message) {
    try {
      ipcRenderer.send("codex-workflow:log", level, String(message));
    } catch {}
  }
}
