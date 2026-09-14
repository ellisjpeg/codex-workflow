"use strict";

const { ipcRenderer, webFrame } = require("electron");

// Build-bound native interoperability: artwork stays in the user's Codex bundle.
async function readWorkflowNativeAssets() {
  if (location.protocol !== "app:") throw Error("Native assets require the app renderer");
  const scripts = document.querySelectorAll('script[type="module"][src="./assets/index-b0a81f126468.js"], script[type="module"][src="./assets/detachedWindow-53e575877f9d.js"]');
  if (scripts.length !== 1 || !/^app:\/\/-\/assets\/(?:index-b0a81f126468|detachedWindow-53e575877f9d)\.js$/.test(scripts[0].src)) throw Error("Unaudited native asset entry");
  const specifications = [
    ["plus16", "shared-icons-693ab6da8dfa.js", "Wu", "Gu", 1, "0 0 16 16"],
    ["plus20", "shared-icons-693ab6da8dfa.js", "Hu", "Uu", 1, "0 0 20 20"],
    ["hand", "app-primary-44ec287874b7.js", "nr", "tr", 1, "0 0 20 20"],
    ["caret", "app-primary-44ec287874b7.js", "_p", "gp", 1, "0 0 16 16"],
    ["microphone", "app-initial-9b95fa538c62.js", "Pn", "Nn", 2, "0 0 20 20"],
    ["voice", "shared-icons-693ab6da8dfa.js", "Mc", "Nc", 4, "0 0 16 16"],
    ["settings", "app-initial-9b95fa538c62.js", "apt", "ipt", 2, "0 0 20 20"],
    ["profile", "app-primary-44ec287874b7.js", "Ix", "Fx", 1, "0 0 20 20"],
    ["menu-chevron", "app-initial-9b95fa538c62.js", "Wft", "Uft", 1, "0 0 20 21"],
    ["menu-check", "shared-icons-693ab6da8dfa.js", "rg", "ng", 1, "0 0 16 16"],
    ["search-clear", "app-initial-9b95fa538c62.js", "bD", "yD", 2, "0 0 20 20"],
    ["help", "app-initial-9b95fa538c62.js", "X", "Y", 2, "0 0 20 20"],
    ["download", "app-initial-9b95fa538c62.js", "TK", "wK", 1, "0 0 20 20"],
  ];
  const tags = new Set(["svg", "g", "path"]);
  const attributes = new Set(["xmlns", "width", "height", "viewBox", "fill", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "d", "transform", "aria-hidden", "focusable"]);
  const element = (value) => {
    if (!value || !tags.has(value.type)) throw Error("Non-static native icon");
    const node = document.createElementNS("http://www.w3.org/2000/svg", value.type);
    for (const [key, data] of Object.entries(value.props)) {
      if (key === "children") {
        for (const child of [data].flat()) if (child != null && child !== false) node.append(element(child));
      } else if (data != null) {
        const name = key === "viewBox" ? key : key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
        if (!attributes.has(name) || !["string", "number", "boolean"].includes(typeof data)) throw Error("Unexpected native icon attribute");
        node.setAttribute(name, String(data));
      }
    }
    return node;
  };
  const result = {};
  for (const [name, file, initialize, exported, paths, viewBox] of specifications) {
    const module = await import(new URL(file, scripts[0].src).href);
    module[initialize]();
    const value = module[exported];
    let svg;
    if (typeof value === "function") svg = element(value({}));
    else {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", value.canvas.viewBox);
      svg.innerHTML = value.body;
    }
    if (svg.localName !== "svg" || svg.getAttribute("viewBox") !== viewBox || svg.querySelectorAll("path").length !== paths) throw Error("Native icon shape changed: " + name);
    for (const node of [svg, ...svg.querySelectorAll("*")]) {
      if (!tags.has(node.localName) || [...node.attributes].some(a => !attributes.has(a.name) ||
        (a.name === "xmlns" ? a.value !== "http://www.w3.org/2000/svg" : /url\s*\(|(?:https?|data|javascript):/i.test(a.value)))) throw Error("Unsafe native SVG");
    }
    result[name] = svg.outerHTML;
  }
  return JSON.stringify(result);
}

let workflowNativeAssets;
async function loadWorkflowNativeAssets() {
  if (document.readyState === "loading") await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  workflowNativeAssets = JSON.parse(await webFrame.executeJavaScript(`(${readWorkflowNativeAssets.toString()})()`));
}

function workflowNativeGlyph(name, className = "icon-sm") {
  const holder = document.createElement("template");
  holder.innerHTML = workflowNativeAssets[name];
  const svg = holder.content.firstElementChild;
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}


function selectUsageWindows(value, selection = "automatic", now = Date.now()) {
  if (value?.unavailable || !Array.isArray(value?.windows)) return [];
  const windows = value.windows.filter((window) =>
    Number.isFinite(window?.usedPercent) && Number.isFinite(window?.windowDurationMins) &&
    window.windowDurationMins > 0 &&
    (window.resetsAt == null || Number.isFinite(window.resetsAt)))
    .filter((window) => window.resetsAt == null || window.resetsAt * 1000 > now)
    .sort((left, right) => left.windowDurationMins - right.windowDurationMins)
    .map((window) => {
      const minutes = window.windowDurationMins;
      const near = (duration) => Math.abs(minutes - duration) <= duration * 0.05;
      const type = near(300) ? "5h" : near(10080) ? "weekly" :
        minutes >= 28 * 1440 && minutes <= 31 * 1440 ? "monthly" : "other";
      return {
        type,
        remaining: Math.round(Math.max(0, Math.min(100, 100 - window.usedPercent))),
        resetsAt: window.resetsAt,
        shortLabel: type === "5h" ? "5hr" : type === "weekly" ? "Weekly" : type === "monthly" ? "Monthly" : "Usage",
        label: type === "5h" ? "5hr limit" : type === "weekly" ? "Weekly limit" : type === "monthly" ? "Monthly limit" : "Usage limit",
      };
    });
  if (value.blocked && windows.length && !windows.some((window) => window.remaining === 0)) {
    windows.reduce((lowest, window) => window.remaining < lowest.remaining ? window : lowest).remaining = 0;
  }
  if (selection === "all") return windows;
  if (selection === "automatic") return [windows.find((window) => window.remaining === 0) || windows[0]].filter(Boolean);
  if (selection === "5h-weekly") {
    const selected = ["5h", "weekly"].map((type) => windows.find((window) => window.type === type));
    return selected.every(Boolean) ? selected : [];
  }
  return windows.filter((window) => window.type === selection).slice(0, 1);
}

function formatUsageReset(resetsAt, now = Date.now()) {
  if (!Number.isFinite(resetsAt) || resetsAt * 1000 <= now) return null;
  let minutes = Math.max(1, Math.ceil((resetsAt * 1000 - now) / 60000));
  const days = Math.floor(minutes / 1440); minutes %= 1440;
  const hours = Math.floor(minutes / 60); minutes %= 60;
  return days ? `${days}d${hours ? ` ${hours}h` : ""}` : hours ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
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
  const empty = { windows: [], blocked: false, unavailable: true, contextPercent: null };
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
  let contextPercent = null;
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
    publish(expired ? { ...empty, contextPercent } : {
      windows,
      blocked: coreBlocked || windows.some((value) => value.usedPercent >= 100),
      unavailable: windows.length === 0,
      contextPercent,
    });
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
  function readContext(scope = native?.tg()) {
    let next = null;
    try {
      const composer = native?.["s$"]?.(scope);
      const conversationId = composer && native?.["a$"]?.(composer);
      const usage = conversationId == null ? null : composer?.get?.(native?.["$Dt"], conversationId);
      const total = usage?.last?.totalTokens;
      const capacity = usage?.modelContextWindow;
      if (Number.isFinite(total) && total >= 0 && Number.isFinite(capacity) && capacity > 0) {
        next = Math.round(Math.min(total, capacity) / capacity * 100);
      }
    } catch {}
    if (next === contextPercent) return;
    contextPercent = next;
    publishWindows();
  }
  function readCache(fresh = false) {
    if (!active || !connected || !authenticated || (needsFresh && !fresh)) return;
    const state = client?.getQueryState(filter.queryKey);
    const raw = state?.data;
    if (state?.status !== "success" || !raw || typeof raw !== "object") {
      slots = [null, null];
      accountId = null;
      lastRaw = undefined;
      publishWindows();
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
    const scope = native?.tg();
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
    readContext(scope);
    if (pending) { queued ||= force || needsFresh; return; }
    const requestEpoch = epoch;
    const requestClient = client;
    pending = Promise.resolve().then(async () => {
      if (!active || requestEpoch !== epoch) return;
      if (needsFresh) await requestClient.cancelQueries(filter);
      if (!active || requestEpoch !== epoch) return;
      const options = scope.query.getOptions(native.rz);
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
        publishWindows();
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
    contextPercent = null;
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
    } else if (message.method === "thread/tokenUsage/updated") {
      queueMicrotask(() => { if (active) readContext(); });
    }
  }
  function connection(message) {
    if (message.hostId !== "local") return;
    connected = message.state === "connected";
    reset();
    if (connected) refresh(true);
  }
  function focus() { refresh(); }
  function route() { queueMicrotask(() => { if (active) { readContext(); refresh(); } }); }
  try {
    const assets = document.querySelectorAll('script[type="module"][src="./assets/index-b0a81f126468.js"]');
    if (assets.length !== 1) throw new Error("Unavailable native usage bridge");
    native = await import(new URL('./app-initial-9b95fa538c62.js', assets[0].src).href);
    const { r: bus } = await import(new URL('./message-bus-828b3d0e2c34.js', assets[0].src).href);
    if (!active) return;
    disposers.push(bus.subscribe("mcp-notification", notification));
    disposers.push(bus.subscribe("codex-app-server-connection-changed", connection));
    disposers.push(bus.subscribe("navigate-to-route", route));
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", owner.stop, { once: true });
    disposers.push(() => window.removeEventListener("focus", focus));
    disposers.push(() => window.removeEventListener("pagehide", owner.stop));
    const scope = bindClient();
    readContext(scope);
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
    schemaVersion: 5, focusedInterface: true, hidePullRequests: true,
    hidePetMenuItem: true, hideInviteFriendMenuItem: true,
    replaceHelpWithSettings: true, hideComposerMicrophone: false,
    composerModelLabel: "full", composerReasoningLabel: "full", composerWidth: "default",
    conversationWidth: null, messageSpacing: "default", userMessageStyle: "bubble",
    toolActivity: "summary", showMessageTimestamps: false,
    showUsageRemaining: true, usageRemainingLocation: "toolbar",
    usageDisplay: "remaining", usageWindow: "automatic",
    showContextUsage: false, lowUsageAlert: false, usageAlertThreshold: 10,
    hiddenSettingsPages: [],
    sidebarNavigation: {
      order: ["pull-requests", "scheduled", "plugins", "explore", "settings-shortcut"],
      hidden: [],
      width: null,
      showRecentChats: true,
      footerShortcut: "whats-new-shortcut",
      settingsOrder: [], settingsHidden: [],
      accountOrder: ["usage", "pet", "invite", "settings", "logout"], accountHidden: [],
    },
  };
  const sections = [
    ["sidebar", "Sidebar & navigation", "Visibility, ordering and shortcuts"],
    ["composer", "Composer", "Microphone, model labels and composer width"],
    ["conversation", "Conversation", "Width, spacing and tool output"],
    ["usage", "Usage & indicators", "Choose what appears and where"],
  ];
  const state = {
    settings: { ...defaults }, settingsWriteInFlight: false, settingControls: new Map(),
    settingsShell: null, settingsNav: null, navWithListener: null, customNav: null,
    customInactiveSnapshot: null, nativeSnapshot: null, loggedSettingsShell: false,
    panel: null, contentArea: null, activeWorkflow: false,
    workflowEntryLocation: null, workflowNativeSlug: null, pendingWorkflowShortcut: false,
    hiddenContent: new Map(), observer: null, mountObservers: [],
    discoveryObserver: null, discoveryTimer: null, scheduled: false,
    query: "", changedOnly: false, filterSwitch: null, resetButton: null, status: null, sectionRows: [],
    page: "home", navigationTab: "app", navigationStyle: null,
    navigationRoot: null, navigationObserver: null, navigationMountObservers: [],
    accountObserver: null, accountTimer: null, accountSizing: null, whatsNewPopup: null, footerShortcut: null, icons: new Map(),
    navigationControls: [], widthInput: null, drag: null,
    composerRoot: null, composerObserver: null, composerMountObservers: [],
    composerTemplate: null, composerLabels: new Map(), composerWidthOwner: null, composerWidthStyle: null,
    conversationRoot: null, conversationObserver: null, conversationMountObservers: [],
    conversationStyle: null, conversationActivity: new Map(), conversationFrame: null,
    webAstraProPortals: new Map(), webAstraProPending: false, webAstraProDirty: false,
    usageData: null, usageButton: null, usagePlacement: null,
    usageToolbar: null, usageToolbarObserver: null, usageMountObservers: [],
    usageBridgeEnabled: false, usageBridgeInFlight: false,
    usageTooltip: null, usageTooltipTimer: null, usageTextTimer: null, usageLocationMenuClose: null,
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
    try { await loadWorkflowNativeAssets(); }
    catch (error) { log("error", `native assets unavailable: ${error?.message || error}`); return; }
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
        if (!needsUsageData() || typeof event.detail !== "string" || event.detail.length > 4096) return;
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
    state.pendingWorkflowShortcut = false;
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
    if (["composer", "conversation", "usage"].includes(state.page)) {
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
      row.addEventListener("click", () => { state.page = key; redrawWorkflowPanel(); });
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
    const footerCopy = div("flex min-w-0 flex-col gap-1");
    footerCopy.append(renderVersionLabel(), status);
    footer.append(footerCopy, update, reset);
    refreshUpdateControl();
    stack.append(setup, customise, footer);
    page.append(titleWrap, stack);
    scroller.append(page);
    shell.append(toolbar, scroller);
    refreshFilters(shell);
    refreshSettingControls();
    return shell;
  }


  function renderVersionLabel() {
    const label = div("text-xs leading-4 text-secondary");
    label.dataset.codexWorkflowVersion = "true";
    label.textContent = state.updateStatus.installedVersion ? `v${state.updateStatus.installedVersion}` : "";
    return label;
  }

  function refreshUpdateControl() {
    for (const label of document.querySelectorAll('[data-codex-workflow-version]')) {
      label.textContent = state.updateStatus.installedVersion ? `v${state.updateStatus.installedVersion}` : "";
    }
    const button = state.updateButton;
    if (!button) return;
    button.hidden = !state.updateStatus.available;
    button.style.display = state.updateStatus.available ? "" : "none";
    button.disabled = state.updateApplying;
    button.textContent = state.updateApplying ? "Updating…" : "Update Workflow";
  }

  const usageSettingKeys = ["showUsageRemaining", "usageRemainingLocation", "usageDisplay", "usageWindow",
    "showContextUsage", "lowUsageAlert", "usageAlertThreshold"];
  const controlsDescriptions = {
    composer: "Arrange the controls you use before sending a message.",
    conversation: "Make long conversations easier to read.",
    usage: "Keep useful limits and status within reach.",
  };

  function sectionChangeCount(key) {
    if (key === "sidebar") return navigationChangeCount();
    const keys = key === "composer" ? composerSettingKeys : key === "conversation" ? conversationSettingKeys : key === "usage" ? usageSettingKeys : [];
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
    back.classList.remove("bg-text/5", "enabled:hover:bg-text/10", "data-[state=open]:bg-text/10");
    back.classList.add("enabled:hover:bg-primary-ghost-hover", "focus-visible:bg-primary-ghost-hover");
    const subtitle = div("text-base text-secondary text-balance");
    subtitle.textContent = controlsDescriptions[state.page];
    const titleStack = div("flex min-w-0 flex-col gap-1.5");
    titleStack.append(title, subtitle);
    header.append(back, titleStack);
    if (state.page === "conversation") {
      renderConversationPage(page, header);
      return;
    }
    if (state.page === "composer") {
      renderComposerPage(page, header);
      return;
    }
    if (state.page === "usage") {
      renderUsagePage(page, header);
      return;
    }
  }

  function renderControlsFooter(resetKey) {
    const footer = div("flex flex-wrap items-center justify-between gap-4");
    const status = div("text-xs leading-4 text-secondary");
    status.setAttribute("role", "status");
    state.status = status;
    const reset = renderActionButton("Reset this section", true);
    reset.addEventListener("click", () => persistSetting(resetKey, true));
    state.resetButton = reset;
    footer.append(status, reset);
    return footer;
  }

  function usageWindowChoices() {
    const types = new Set(selectUsageWindows(state.usageData, "all").map((window) => window.type));
    const choices = [["automatic", "Automatic"]];
    if (types.has("5h")) choices.push(["5h", "5hr"]);
    if (types.has("weekly")) choices.push(["weekly", "Weekly"]);
    if (types.has("monthly")) choices.push(["monthly", "Monthly"]);
    if (types.has("5h") && types.has("weekly")) choices.push(["5h-weekly", "5hr + Weekly"]);
    return choices;
  }

  function renderUsagePage(page, header) {
    const stack = div("flex flex-col gap-10");
    const usage = sectionHeading("Usage");
    const usageCard = settingsCard();
    usageCard.append(
      renderSettingRow({key:"showUsageRemaining", label:"Show remaining usage", description:"Keep your active usage window visible."}),
      renderComposerChoice("usageRemainingLocation", "Placement", "Choose where the indicator appears.", [["toolbar", "Toolbar"], ["composer", "Composer"]]),
      renderComposerChoice("usageDisplay", "Display", "Choose which details are shown.", [["remaining", "Remaining"], ["remaining-reset", "Remaining + reset"]]),
      renderComposerChoice("usageWindow", "Usage window", "Choose the limit shown in the indicator.", usageWindowChoices));
    usage.append(usageCard);

    const context = sectionHeading("Context & alerts");
    const contextCard = settingsCard();
    contextCard.append(
      renderSettingRow({key:"showContextUsage", label:"Show context usage", description:"Display how much context this conversation uses."}),
      renderSettingRow({key:"lowUsageAlert", label:"Low usage alert", description:"Highlight the indicator when usage is running low."}),
      renderUsageThresholdRow());
    context.append(contextCard);

    const disableChoice = (key, unavailable) => {
      const control = state.settingControls.get(key);
      const applyDisabled = control.applyDisabled;
      control.applyDisabled = disabled => applyDisabled(disabled || unavailable());
    };
    disableChoice("usageRemainingLocation", () => !state.settings.showUsageRemaining && !state.settings.showContextUsage);
    disableChoice("usageDisplay", () => !state.settings.showUsageRemaining);
    disableChoice("usageWindow", () => !state.settings.showUsageRemaining);
    disableChoice("usageAlertThreshold", () => !state.settings.showUsageRemaining || !state.settings.lowUsageAlert);

    const footer = renderControlsFooter("resetUsage");
    stack.append(usage, context, footer);
    page.append(header, stack);
    refreshSettingControls();
  }

  // Native Appearance contrast slider, including its platform thumb geometry.
  const nativeRangeClass = "h-0.5 min-w-0 flex-1 appearance-none rounded-full cursor-interaction focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-transparent [&::-moz-range-thumb]:bg-current [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded-full [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:mt-[-9px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-transparent [&::-webkit-slider-thumb]:bg-current [&::-webkit-slider-thumb]:shadow-sm";

  function renderUsageThresholdRow() {
    const row = renderControlRow({key:"usageAlertThreshold", label:"Alert threshold", description:"Choose when the low-usage highlight appears."});
    row.classList.add("flex-wrap");
    const slot = row.lastElementChild;
    slot.className = "flex h-9 min-w-0 flex-1 basis-64 items-center gap-2.5";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "1";
    input.max = "50";
    input.step = "1";
    input.setAttribute("aria-labelledby", "codex-workflow-usageAlertThreshold-label");
    input.setAttribute("aria-describedby", "codex-workflow-usageAlertThreshold-description");
    input.className = nativeRangeClass;
    const value = div("shrink-0 text-end text-sm text-secondary tabular-nums");
    const apply = threshold => {
      input.value = String(threshold);
      value.textContent = `${threshold}%`;
      input.setAttribute("aria-valuetext", `${threshold}% remaining`);
      const percentage = (threshold - 1) / 49 * 100;
      input.style.background = `linear-gradient(to right, var(--color-chart-blue) ${percentage}%, var(--color-border) ${percentage}%)`;
      input.style.color = "var(--color-text)";
    };
    input.addEventListener("input", () => { apply(input.valueAsNumber); updateUsageText(input.valueAsNumber); });
    input.addEventListener("change", () => persistSetting("usageAlertThreshold", input.valueAsNumber));
    state.settingControls.set("usageAlertThreshold", {apply, applyDisabled:disabled=>{input.disabled=disabled;}});
    slot.append(input, value);
    return row;
  }

  // Workflow-owned inert sample, composed against audited native CSS interfaces.
  // No native HTML snapshot, editor state, React tree or artwork is distributed.
  function createComposerExample() {
    const node = (tag, classes, attributes = {}, ...children) => {
      const element = document.createElement(tag);
      element.className = classes;
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      element.append(...children);
      return element;
    };
    const span = (classes, ...children) => node("span", classes, {}, ...children);
    const buttonClasses = "no-drag cursor-interaction items-center select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-40 gap-1 border whitespace-nowrap flex rounded-full text-tertiary enabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border-transparent h-token-button-composer px-(--padding-button-composer-inline,calc(var(--spacing)*2)) py-0 text-(length:--text-button-composer,var(--text-sm)) leading-(--line-height-button-composer,18px)";
    const button = (label, classes, ...children) => node("button", buttonClasses + " " + classes, {type:"button", "aria-label":label}, ...children);
    const editor = node("div", "ProseMirror", {contenteditable:"false", role:"textbox", "aria-multiline":"true", "aria-label":"Do anything", "data-composer-markdown":""});
    editor.style.fontSize = "var(--codex-chat-font-size)";
    editor.style.minHeight = "var(--composer-editor-min-height, 2.5rem)";
    const input = node("div", "min-w-0 _AdaptiveFooterInput_1qpwu_2 col-span-full row-start-1 -mx-2", {},
      node("div", "_ComposerLayoutInput_1qpwu_2 flex-grow overflow-y-auto", {"data-composer-layout":"multiline", "data-composer-spacing":"default", "data-composer-input-variant":"default"},
        node("div", "_RichTextInput_88kve_2 vertical-scroll-fade-mask text-base min-h-0", {"data-rich-text-layout":"multiline", role:"presentation"}, editor)));
    const add = button("Add files and more", "aspect-square shrink-0 justify-center !px-0",
      span("_CompactSource_3pdaq_2", workflowNativeGlyph("plus16", "_Icon_qvjuo_1 text-default")),
      span("_LeadingSource_3pdaq_6", workflowNativeGlyph("plus20", "_Icon_qvjuo_1 text-default")));
    for (const svg of add.querySelectorAll("svg")) {
      const size = svg.getAttribute("viewBox").split(" ")[2];
      svg.setAttribute("width", size); svg.setAttribute("height", size);
    }
    const permission = button("Change permissions", "min-w-0 px-1.5 text-sm leading-[18px]",
      span("_ComposerDropdownLabelIcon_xqyck_15", workflowNativeGlyph("hand", "icon-xs shrink-0 text-tertiary")),
      node("span", "_ComposerFooterLabel_qf7ox_1 max-w-40 truncate text-tertiary font-normal", {"data-composer-footer-collapse":"secondary"}, "Ask for approval"));
    const model = button("Select model and reasoning", "min-w-0 shrink-0",
      span("_ModelPickerTriggerContent_bvaoz_1 font-normal",
        span("_ModelPickerTriggerLabel_bvaoz_18",
          span("_ModelPickerTriggerModelText_bvaoz_42 text-default tabular-nums", "GPT-6 Astra"),
          node("span", "_ComposerFooterLabel_qf7ox_1 _ModelPickerTriggerEffortLabel_bvaoz_54", {"data-composer-footer-collapse":"none"}, "Medium"))),
      workflowNativeGlyph("caret", "me-0.5 h-3.5 w-3.5 shrink-0 text-tertiary"));
    model.dataset.codexIntelligenceTrigger = "true";
    model.dataset.composerNavigationTarget = "reasoning";
    const voice = node("button", "cursor-interaction size-token-button-composer flex items-center justify-center rounded-full bg-composer-primary p-0.5", {type:"button", "aria-label":"Start new voice chat"}, workflowNativeGlyph("voice", "_Icon_qvjuo_1 icon-primary-action text-composer-primary"));
    voice.firstElementChild.setAttribute("width", "16"); voice.firstElementChild.setAttribute("height", "16");
    const actions = node("div", "flex shrink-0 items-center", {},
      button("Dictate", "aspect-square shrink-0 justify-center !px-0", workflowNativeGlyph("microphone", "icon-leading text-default")),
      node("div", "ms-2 flex items-center", {}, voice));
    const footer = node("div", "_ComposerLayoutFooter_1qpwu_2", {"data-composer-footer-responsive":"", "data-composer-layout":"multiline", "data-composer-rows":"stacked", "data-composer-spacing":"default"}, input,
      node("div", "min-w-0 col-start-1 row-start-2", {}, node("div", "flex min-w-0 items-center gap-[5px]", {}, add, permission)),
      node("div", "min-w-0 col-start-3 row-start-2", {}, node("div", "flex min-w-0 items-center justify-end w-full", {},
        node("div", "flex min-w-0 flex-1 justify-end", {}, node("div", "flex min-w-0 items-center gap-1", {}, model)), actions)));
    return cloneComposer(node("div", "_ComposerLayoutRoot_1qpwu_2 gap-2", {role:"presentation", "data-composer-layout":"multiline", "data-composer-padding-variant":"none", "data-composer-radius-variant":"default", "data-composer-surface-overflow":"visible", "data-composer-surface-variant":"default", "data-composer-utility-bar-variant":"home"},
      node("div", "_ComposerLayoutBody_1qpwu_2", {"data-composer-layout":"multiline"},
        node("div", "_ComposerLayoutAttachments_1qpwu_2", {"data-composer-attachments":"", "data-composer-spacing":"default"}), footer)));
  }

  const composerSettingKeys = ["hideComposerMicrophone", "composerModelLabel", "composerReasoningLabel", "composerWidth"];
  // Guarded 26.908.40834 model picker; semantic trigger scopes these CSS-module leaves.
  const composerModelSelector = '[data-codex-intelligence-trigger="true"][data-composer-navigation-target="reasoning"] ._ModelPickerTriggerModelText_bvaoz_42';
  const composerEffortSelector = '[data-codex-intelligence-trigger="true"][data-composer-navigation-target="reasoning"] ._ModelPickerTriggerEffortLabel_bvaoz_54';
  // Native thread-scroll-layout shifts both columns for side panels. Keep its free-space allowance.
  const wideComposerWidth = "calc(100% - 2 * var(--thread-wide-block-inline-shift, 0px))";

  function renderComposerPage(page, header) {
    const stack = div("flex flex-col gap-10");
    const preview = sectionHeading("Preview");
    const frame = settingsCard();
    frame.classList.add("p-4");
    frame.dataset.codexWorkflowPreview = "true";
    frame.setAttribute("role", "img");
    preview.append(frame);
    const controls = sectionHeading("Controls");
    const card = settingsCard();
    const microphone = renderSettingRow({key:"hideComposerMicrophone", label:"Microphone", description:"Show the dictation button."});
    const control = state.settingControls.get("hideComposerMicrophone");
    const applyHidden = control.apply;
    control.apply = hidden => applyHidden(!hidden);
    card.append(microphone,
      renderComposerChoice("composerModelLabel", "Model label", "Choose how much of the model name is shown.", [["full", "Full name"], ["short", "Short name"]]),
      renderComposerChoice("composerReasoningLabel", "Reasoning label", "Choose the label beside your model.", [["full", "Full name"], ["compact", "Compact"]]));
    controls.append(card);
    const layout = sectionHeading("Layout");
    const layoutCard = settingsCard();
    layoutCard.append(renderComposerChoice("composerWidth", "Composer width", "Set the width of the message input and conversation.", [["default", "Default"], ["wide", "Wide"]], true));
    layout.append(layoutCard);
    const footer = renderControlsFooter("resetComposer");
    stack.append(preview, controls, layout, footer);
    page.append(header, stack);
    refreshSettingControls();
    refreshComposerPreview(frame);
  }

  const conversationSettingKeys = ["conversationWidth", "messageSpacing", "userMessageStyle", "toolActivity", "showMessageTimestamps"];
  // Audited 26.903.71938: the native message column, separate from the composer column.
  const conversationSelector = '.thread-scroll-container[data-app-action-timeline-scroll] [data-thread-user-message-navigation-content="true"]';
  const activitySelector = 'button[aria-expanded].max-w-full.text-size-chat:not([aria-haspopup])';

  function renderConversationPage(page, header) {
    const stack = div("flex flex-col gap-10");
    const preview = sectionHeading("Preview");
    const frame = settingsCard();
    frame.classList.add("p-4");
    frame.dataset.codexWorkflowConversationPreview = "true";
    frame.setAttribute("aria-label", "Conversation preview");
    frame.setAttribute("role", "group");
    preview.append(frame);
    const layout = sectionHeading("Layout");
    const card = settingsCard();
    const widthRow = renderControlRow({key:"conversationWidth", label:"Conversation width", description:"Set the maximum width of messages."});
    widthRow.classList.add("flex-wrap");
    const slot = widthRow.lastElementChild;
    slot.className = "flex h-9 min-w-0 flex-1 basis-64 items-center gap-2.5";
    const input = document.createElement("input");
    input.type = "range"; input.min = "480"; input.max = "1440"; input.step = "8";
    input.setAttribute("aria-labelledby", "codex-workflow-conversationWidth-label");
    input.setAttribute("aria-describedby", "codex-workflow-conversationWidth-description");
    input.className = nativeRangeClass;
    const value = div("shrink-0 text-end text-sm text-secondary tabular-nums");
    const apply = width => {
      input.value = String(width ?? 768); // Native default column is 48rem on this build.
      value.textContent = width == null ? "Default" : `${input.value} px`;
      input.setAttribute("aria-valuetext", width == null ? "Native default" : `${input.value} pixels`);
      const percentage = (Number(input.value) - 480) / 960 * 100;
      input.style.background = `linear-gradient(to right, var(--color-chart-blue) ${percentage}%, var(--color-border) ${percentage}%)`;
      input.style.color = "var(--color-text)";
    };
    input.addEventListener("input", () => { apply(input.valueAsNumber); refreshConversationPreview(frame, input.valueAsNumber); });
    input.addEventListener("change", () => persistSetting("conversationWidth", input.valueAsNumber));
    state.settingControls.set("conversationWidth", {apply, applyDisabled:disabled=>{input.disabled=disabled;}});
    slot.append(input, value);
    card.append(widthRow,
      renderComposerChoice("messageSpacing", "Message spacing", "Choose the gap between messages.", [["compact","Compact"],["default","Default"],["relaxed","Relaxed"]], true),
      renderComposerChoice("userMessageStyle", "User messages", "Choose how your prompts are displayed.", [["bubble","Bubble"],["plain","Plain text"]]));
    // Preserve usable controls when the settings pane is narrower than the window.
    for (const row of card.children) {
      row.classList.add("flex-wrap");
      row.firstElementChild.classList.add("basis-64");
    }
    layout.append(card);
    const details = sectionHeading("Message details");
    const detailCard = settingsCard();
    detailCard.append(
      renderComposerChoice("toolActivity", "Tool activity", "Choose the initial view of tool calls.", [["summary","Summary"],["expanded","Expanded"]]),
      renderSettingRow({key:"showMessageTimestamps", label:"Show timestamps", description:"Display the time beside each message."}));
    details.append(detailCard);
    const footer = renderControlsFooter("resetConversation");
    stack.append(preview, layout, details, footer);
    page.append(header, stack);
    refreshSettingControls();
    refreshConversationPreview(frame);
  }

  function refreshConversationPreview(frame = state.panel?.querySelector('[data-codex-workflow-conversation-preview]'), width = state.settings.conversationWidth) {
    if (!frame) return;
    const prefs = state.settings;
    const signature = JSON.stringify(conversationSettingKeys.map(key=>key === "conversationWidth" ? width : prefs[key]));
    if (frame.dataset.previewState === signature) return;
    frame.dataset.previewState = signature;
    const column = div("mx-auto flex w-full min-w-0 flex-col");
    // A proportional example makes the width control observable even in a narrow settings pane.
    column.style.width = `${Math.min(100, (width ?? (prefs.composerWidth === "wide" ? 1440 : 768)) / 1440 * 100)}%`;
    column.style.minWidth = "min(100%, 20rem)";
    column.style.gap = prefs.messageSpacing === "compact" ? "calc(var(--spacing) * 2)" : prefs.messageSpacing === "relaxed" ? "calc(var(--spacing) * 6)" : "calc(var(--spacing) * 4)";
    const user = div("flex min-w-0 flex-col items-end gap-1");
    const bubble = div(prefs.userMessageStyle === "bubble"
      ? "bg-user-message text-user-message min-w-0 overflow-hidden break-words px-3 py-2.5 rounded-2xl text-size-chat"
      : "max-w-(--user-chat-width) min-w-0 break-words text-default text-size-chat");
    bubble.textContent = "Make the sidebar more compact.";
    user.append(bubble);
    const assistant = div("flex min-w-0 flex-col gap-1");
    const message = div("text-size-chat text-default");
    message.textContent = "Updated the spacing and kept the labels readable.";
    assistant.append(message);
    const activity = div("flex flex-col gap-2");
    const toggle = renderActionButton("3 tools used");
    toggle.className = "no-drag cursor-interaction flex max-w-full items-center gap-1 self-start rounded-md text-size-chat text-secondary enabled:hover:bg-primary-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    const chevron = navigationGlyph("back");
    chevron.style.transform = "rotate(180deg)";
    toggle.prepend(chevron);
    const body = div("flex flex-col gap-1 text-sm text-secondary ps-6");
    body.id = "codex-workflow-conversation-preview-tools";
    for (const text of ["Read sidebar layout", "Adjusted message spacing", "Checked the result"]) {
      const line = div(""); line.textContent = text; body.append(line);
    }
    const expand = expanded => {
      toggle.setAttribute("aria-expanded", String(expanded));
      body.hidden = !expanded;
      body.style.display = expanded ? "" : "none";
      chevron.style.transform = expanded ? "rotate(270deg)" : "rotate(180deg)";
      const reduced = document.documentElement.dataset.reducedMotion === "true" ||
        (document.documentElement.dataset.reducedMotion == null && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      if (expanded && !reduced && body.animate) {
        body.animate([{opacity:0, transform:"translateY(-8px)"},{opacity:1, transform:"translateY(0)"}], {duration:220,easing:"cubic-bezier(.33,1,.68,1)"});
      }
    };
    toggle.setAttribute("aria-controls", body.id);
    toggle.addEventListener("click", () => expand(toggle.getAttribute("aria-expanded") !== "true"));
    expand(prefs.toolActivity === "expanded");
    activity.append(toggle, body);
    assistant.append(activity);
    if (prefs.showMessageTimestamps) for (const [owner, time] of [[user,"10:24"],[assistant,"10:25"]]) {
      const stamp = document.createElement("time");
      stamp.className = "text-xs text-tertiary";
      stamp.textContent = time; stamp.dateTime = time;
      owner.append(stamp);
    }
    column.append(user, assistant);
    frame.replaceChildren(column);
  }

  function restoreConversationActivity() {
    for (const [button, saved] of state.conversationActivity) {
      button.removeEventListener("click", saved.listener);
      if (button.isConnected && !saved.manual && button.getAttribute("aria-expanded") === saved.applied && saved.original !== saved.applied) button.click();
    }
    state.conversationActivity.clear();
  }

  function syncConversationActivity() {
    const root = state.conversationRoot;
    if (!root || !state.settings.focusedInterface) return;
    for (const [button, saved] of state.conversationActivity) if (!root.contains(button)) {
      button.removeEventListener("click", saved.listener);
      state.conversationActivity.delete(button);
    }
    for (const turn of root.querySelectorAll('[data-content-search-turn-key]')) {
      // Cca/MD: top-level completed-turn activity only, never tool cards, menus or approval UI.
      const buttons = [...turn.querySelectorAll(activitySelector)].filter(button =>
        button.closest('[data-content-search-turn-key]') === turn && !button.closest('[data-content-search-unit-key], [role="dialog"], [role="menu"]') &&
        button.querySelector('svg.icon-2xs'));
      if (buttons.length !== 1) continue;
      const button = buttons[0];
      let saved = state.conversationActivity.get(button);
      if (saved?.mode === state.settings.toolActivity) continue;
      if (!saved) {
        saved = {original:button.getAttribute("aria-expanded"), manual:false, applying:false};
        saved.listener = () => { if (!saved.applying) saved.manual = true; };
        button.addEventListener("click", saved.listener);
        state.conversationActivity.set(button, saved);
      }
      saved.mode = state.settings.toolActivity; saved.manual = false;
      saved.applied = String(saved.mode === "expanded");
      if (button.getAttribute("aria-expanded") !== saved.applied) {
        saved.applying = true;
        try { button.click(); } finally { saved.applying = false; }
      }
    }
  }

  function syncConversation() {
    const roots = [...document.querySelectorAll(conversationSelector)].filter(root => !root.closest('[role="dialog"], [data-codex-workflow-panel]'));
    const root = roots.length === 1 ? roots[0] : null;
    if (!root) for (const candidate of roots) candidate.removeAttribute("data-codex-workflow-conversation");
    if (state.conversationRoot !== root) {
      state.conversationObserver?.disconnect();
      disconnectObservers(state.conversationMountObservers);
      restoreConversationActivity();
      state.conversationRoot?.removeAttribute("data-codex-workflow-conversation");
      state.conversationRoot = root;
      state.conversationMountObservers = root ? observeMountChain("conversation", root) : [];
      if (root) {
        state.conversationObserver = new MutationObserver(records => {
          // Ignore streamed text and unrelated mutations; only newly mounted turn/disclosure structure matters.
          if (!records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element &&
            (node.matches(`[data-content-search-turn-key], ${activitySelector}`) || node.querySelector(`[data-content-search-turn-key], ${activitySelector}`))))) return;
          if (state.conversationFrame != null) return;
          state.conversationFrame = requestAnimationFrame(() => { state.conversationFrame = null; syncConversationActivity(); });
        });
        state.conversationObserver.observe(root, {childList:true, subtree:true});
      }
    }
    const enabled = state.settings.focusedInterface;
    if (root && enabled) root.setAttribute("data-codex-workflow-conversation", "true");
    else root?.removeAttribute("data-codex-workflow-conversation");
    if (!enabled) restoreConversationActivity();
    const scope = '[data-codex-workflow-conversation="true"]';
    const css = [];
    if (enabled) {
      const prefs = state.settings;
      if (prefs.conversationWidth != null) css.push(`${scope} { max-width: min(${prefs.conversationWidth}px, calc(100% - 2 * var(--thread-wide-block-inline-shift, 0px))); }`);
      if (prefs.messageSpacing !== "default") css.push(`${scope} { --conversation-item-gap: calc(var(--spacing) * ${prefs.messageSpacing === "compact" ? 2 : 6}); }`);
      if (prefs.userMessageStyle === "plain") css.push(`${scope} [data-local-conversation-user-anchor] [data-user-message-bubble] { --color-text-user-message: var(--color-text); background: transparent; color: var(--color-text); border-radius: 0; padding: 0; }`);
      if (prefs.showMessageTimestamps) css.push(`
        ${scope} [data-assistant-message-sent-time] { opacity: 1; }
        ${scope} [data-local-conversation-user-anchor] .group > .flex-row-reverse > div:has(> .turn-action-controls),
        ${scope} [data-local-conversation-user-anchor] .group > .flex-row-reverse > div:has(> .turn-action-controls) > span { opacity: 1; }
        ${scope} [data-local-conversation-user-anchor] .group > .flex-row-reverse > div:has(> .turn-action-controls) { transition: column-gap var(--transition-duration-basic) ease-out; }
        ${scope} [data-local-conversation-user-anchor] .turn-action-controls { interpolate-size: allow-keywords; inline-size: max-content; justify-content: flex-end; transition: inline-size var(--transition-duration-basic) ease-out, opacity var(--transition-duration-basic) ease-out; }
        ${scope} [data-local-conversation-user-anchor] .turn-action-controls button { flex-shrink: 0; }
        ${scope} [data-local-conversation-user-anchor] .group:not(:hover):not(:focus-within) > .flex-row-reverse > div:has(> .turn-action-controls) { column-gap: 0; }
        ${scope} [data-local-conversation-user-anchor] .group:not(:hover):not(:focus-within) .turn-action-controls { inline-size: 0; opacity: 0; pointer-events: none; }
        :root[data-reduced-motion="true"] ${scope} [data-local-conversation-user-anchor] .turn-action-controls,
        :root[data-reduced-motion="true"] ${scope} [data-local-conversation-user-anchor] .group > .flex-row-reverse > div:has(> .turn-action-controls) { transition: none; }
        @media (prefers-reduced-motion: reduce) {
          :root:not([data-reduced-motion="false"]) ${scope} [data-local-conversation-user-anchor] .turn-action-controls,
          :root:not([data-reduced-motion="false"]) ${scope} [data-local-conversation-user-anchor] .group > .flex-row-reverse > div:has(> .turn-action-controls) { transition: none; }
        }
      `);
    }
    if (css.length) {
      if (!state.conversationStyle) {
        state.conversationStyle = document.createElement("style");
        state.conversationStyle.dataset.codexWorkflowConversationStyle = "true";
        document.head.append(state.conversationStyle);
      }
      const text = css.join("\n");
      if (state.conversationStyle.textContent !== text) state.conversationStyle.textContent = text;
    } else { state.conversationStyle?.remove(); state.conversationStyle = null; }
    syncConversationActivity();
    refreshConversationPreview();
  }

  function renderComposerChoice(key, labelText, description, choices, segmented = false) {
    const readChoices = () => typeof choices === "function" ? choices() : choices;
    const row = renderControlRow({key, label:labelText, description});
    const slot = row.lastElementChild;
    if (segmented) {
      const group = div("flex min-w-0 items-center gap-1 rounded-lg border border-default p-1");
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", `codex-workflow-${key}-label`);
      group.setAttribute("aria-describedby", `codex-workflow-${key}-description`);
      const buttons = readChoices().map(([value, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => persistSetting(key, value));
        group.append(button);
        return {button, value};
      });
      state.settingControls.set(key, {
        apply: value => buttons.forEach(item => {
          const selected = item.value === value;
          item.button.className = `${segmentClass} ${selected ? "bg-segmented-selected hover:bg-segmented-selected-hover text-default" : "hover:bg-primary-ghost-hover text-tertiary"}`;
          item.button.setAttribute("aria-pressed", String(selected));
        }),
        applyDisabled: disabled => buttons.forEach(({button}) => {button.disabled = disabled;}),
      });
      slot.append(group);
    } else {
      const {button, label} = nativeMenuButton();
      button.setAttribute("aria-labelledby", `codex-workflow-${key}-label`);
      button.setAttribute("aria-describedby", `codex-workflow-${key}-description`);
      const open = event => {
        event.preventDefault();
        if (button.disabled) return;
        const available = readChoices();
        const selected = available.some(([value]) => value === state.settings[key]) ? state.settings[key] : available[0]?.[0];
        openWorkflowMenu(button, {id:key, label:labelText, choices:available.map(([value,label])=>({value,label})), selected, select:value=>persistSetting(key,value)});
      };
      button.addEventListener("click", open);
      button.addEventListener("keydown", event => {if (["ArrowDown", "ArrowUp"].includes(event.key)) open(event);});
      state.settingControls.set(key, {button, apply:value=>{
        const available = readChoices();
        label.textContent = (available.find(item => item[0] === value) || available[0])?.[1] || "";
      }, applyDisabled:disabled=>{button.disabled=disabled;}});
      slot.append(button);
    }
    return row;
  }

  function composerLabel(text, kind) {
    if (kind === "model" && state.settings.composerModelLabel === "short") return text.replace(/^GPT[- ]\d+(?:\.\d+)?\s+(?=\S)/iu, "");
    if (kind === "effort" && state.settings.composerReasoningLabel === "compact") return ({Minimal:"Min", Medium:"Med", "Extra high":"XHigh", "Very high":"XHigh"})[text] || text;
    return text;
  }

  function restoreComposerLabels() {
    for (const [node, saved] of state.composerLabels) if (node.data === saved.applied) node.data = saved.original;
    state.composerLabels.clear();
  }

  function composerTextLeaves(leaf) {
    const layers = [...leaf.querySelectorAll('.sr-only, [data-reasoning-effort]')];
    return layers.length ? layers : [leaf];
  }

  function syncComposerLabels() {
    const desired = new Set();
    for (const [selector, kind] of [[composerModelSelector, "model"], [composerEffortSelector, "effort"]]) {
      const matches = [...(state.composerRoot?.querySelectorAll(selector) || [])];
      if (matches.length !== 1) continue;
      for (const leaf of composerTextLeaves(matches[0])) {
        if (leaf.childNodes.length !== 1 || leaf.firstChild.nodeType !== Node.TEXT_NODE) continue;
        const node = leaf.firstChild;
        desired.add(node);
        const old = state.composerLabels.get(node);
        const original = old && node.data === old.applied ? old.original : node.data;
        const applied = composerLabel(original, kind);
        state.composerLabels.set(node, {original, applied});
        if (node.data !== applied) node.data = applied;
      }
    }
    for (const [node, saved] of state.composerLabels) if (!desired.has(node)) {
      if (node.data === saved.applied) node.data = saved.original;
      state.composerLabels.delete(node);
    }
  }

  function syncComposerWidth() {
    const root = state.composerRoot;
    // One inherited token keeps the native message column and composer aligned.
    const owner = root?.closest('.thread-scroll-container[data-app-action-timeline-scroll]') ||
      root?.closest('[class~="max-w-(--thread-content-max-width)"]');
    const target = state.settings.composerWidth === "wide" ? owner : null;
    const saved = state.composerWidthOwner;
    if (saved && saved.node !== target) {
      if (saved.node.style.getPropertyValue("--thread-content-max-width") === wideComposerWidth) {
        if (saved.value) saved.node.style.setProperty("--thread-content-max-width", saved.value, saved.priority);
        else saved.node.style.removeProperty("--thread-content-max-width");
        if (!saved.hadStyle && !saved.node.getAttribute("style")) saved.node.removeAttribute("style");
      }
      delete saved.node.dataset.codexWorkflowComposerWidth;
      state.composerWidthOwner = null;
    }
    if (!target) {
      state.composerWidthStyle?.remove();
      state.composerWidthStyle = null;
      return;
    }
    if (!state.composerWidthStyle) {
      const style = document.createElement("style");
      style.dataset.codexWorkflowComposerWidthStyle = "true";
      // Resolve the inherited shift on each native column, after Motion sets it on their parents.
      style.textContent = `[data-codex-workflow-composer-width="wide"] [class~="max-w-(--thread-content-max-width)"] { --thread-content-max-width: ${wideComposerWidth}; }`;
      document.head.append(style);
      state.composerWidthStyle = style;
    }
    if (!state.composerWidthOwner) state.composerWidthOwner = {node:target, value:target.style.getPropertyValue("--thread-content-max-width"), priority:target.style.getPropertyPriority("--thread-content-max-width"), hadStyle:target.hasAttribute("style")};
    target.dataset.codexWorkflowComposerWidth = "wide";
    if (target.style.getPropertyValue("--thread-content-max-width") !== wideComposerWidth) target.style.setProperty("--thread-content-max-width", wideComposerWidth);
  }

  function cloneComposer(root) {
    const clone = root.cloneNode(true);
    restoreComposerMicrophones(clone);
    const originalLeaves = [...root.querySelectorAll(`${composerModelSelector}, ${composerEffortSelector}`)].flatMap(composerTextLeaves);
    [...clone.querySelectorAll(`${composerModelSelector}, ${composerEffortSelector}`)].flatMap(composerTextLeaves).forEach((leaf, i) => {
      const saved = state.composerLabels.get(originalLeaves[i]?.firstChild);
      if (saved) leaf.textContent = saved.original;
    });
    // An inert clone has no native animation effects. Keep the selected label,
    // not the overlapping effort layers or their last measured width.
    clone.querySelectorAll(composerEffortSelector).forEach(leaf => {
      const selected = leaf.querySelector('.sr-only');
      if (selected) {
        leaf.textContent = selected.textContent;
        leaf.style.removeProperty("width");
      }
    });
    clone.querySelectorAll('[data-composer-attachments]').forEach(node => node.replaceChildren());
    clone.querySelectorAll('[contenteditable]').forEach(node => {
      node.replaceChildren();
      const p = document.createElement("p");
      p.className = "placeholder";
      p.dataset.placeholder = "Ask Codex anything…";
      p.append(document.createElement("br"));
      node.append(p);
      node.setAttribute("contenteditable", "false");
      node.classList.remove("ProseMirror-focused");
    });
    clone.querySelectorAll('[data-codex-workflow-usage]').forEach(node=>node.remove());
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) if (["id", "href", "for", "name", "value", "autofocus", "aria-controls", "aria-owns", "aria-labelledby", "aria-describedby", "data-codex-composer", "data-codex-thread-reference-drop-target", "data-virtualkeyboard"].includes(attr.name) || attr.name.startsWith("on")) node.removeAttribute(attr.name);
      if (node.matches('button, input, textarea, [tabindex]')) node.tabIndex = -1;
    }
    clone.inert = true;
    clone.setAttribute("aria-hidden", "true");
    return clone;
  }

  function captureComposer(root) {
    // React mounts/unmounts editor and picker separately. Never cache a partial shell.
    if (root?.querySelector(composerModelSelector) && root.querySelector('[contenteditable="true"]')) {
      state.composerTemplate = cloneComposer(root);
    }
  }

  function refreshComposerPreview(frame = state.panel?.querySelector('[data-codex-workflow-preview]')) {
    if (!frame) return;
    if (!frame.firstElementChild) {
      let template = state.composerTemplate;
      if (!template) template = createComposerExample();
      frame.append(template.cloneNode(true));
    }
    const root = frame.firstElementChild;
    root.inert = true;
    root.classList.add("w-full", "mx-auto");
    // Same native cap as the real column; narrow settings naturally show equal widths.
    root.style.maxWidth = state.settings.composerWidth === "wide" ? "100%" : "var(--thread-content-max-width)";
    root.querySelectorAll('button[aria-label="Dictate"]').forEach(node => {node.style.display = state.settings.hideComposerMicrophone ? "none" : "";});
    for (const [selector,kind] of [[composerModelSelector,"model"],[composerEffortSelector,"effort"]]) {
      [...root.querySelectorAll(selector)].flatMap(composerTextLeaves).forEach(node => {
        node.dataset.workflowPreviewOriginal ??= node.textContent;
        const next = composerLabel(node.dataset.workflowPreviewOriginal, kind);
        if (node.textContent !== next) node.textContent = next;
      });
    }
    const effort = root.querySelector(composerEffortSelector);
    const label = `Composer preview. ${root.querySelector(composerModelSelector)?.textContent || ""}. ${effort ? composerTextLeaves(effort)[0].textContent : ""}. Microphone ${state.settings.hideComposerMicrophone ? "hidden" : "shown"}. ${state.settings.composerWidth === "wide" ? "Wide" : "Default"} width.`;
    if (frame.getAttribute("aria-label") !== label) frame.setAttribute("aria-label", label);
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
    const roots = [...document.querySelectorAll(composerRootSelector)].filter(root => !root.closest('[data-codex-workflow-preview]'));
    const root = roots.length === 1 ? roots[0] : null;
    if (state.composerRoot !== root) {
      state.composerObserver?.disconnect();
      disconnectObservers(state.composerMountObservers);
      captureComposer(state.composerRoot);
      restoreComposerMicrophones(state.composerRoot);
      restoreComposerLabels();
      state.composerRoot = root;
      state.composerMountObservers = [];
      if (root) {
        captureComposer(root);
        state.composerObserver = new MutationObserver(() => {
          captureComposer(root);
          scheduleWork();
        });
        state.composerObserver.observe(root, { childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter: ["aria-label", "aria-controls", "aria-describedby", "data-selected-reasoning-effort"] });
        state.composerMountObservers = observeMountChain("composer", root);
      }
    }
    syncComposerMicrophone();
    syncUsageRemaining();
    syncWebAstraPro();
    syncComposerLabels();
    syncComposerWidth();
    refreshComposerPreview();
    syncConversation();
  }

  function nativeMenuButton() {
    const button = document.createElement("button");
    button.type = "button";
    // General > Send shortcut, Codex 26.908.40834 / 8881.
    button.className = "no-drag cursor-interaction items-center select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-40 gap-1 border whitespace-nowrap flex rounded-button-toolbar border-default bg-primary-soft-alpha enabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover button-toolbar py-0 text-sm leading-[18px] max-w-full justify-between px-3 outline-hidden";
    button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false");
    button.dataset.state = "closed";
    const label = document.createElement("span");
    label.className = "flex min-w-0 flex-1 items-center gap-1.5";
    const chevron = workflowNativeGlyph("menu-chevron", "icon-2xs shrink-0 text-tertiary");
    chevron.querySelector("path").setAttribute("stroke-width", "0.6");
    button.append(label, chevron);
    return {button, label};
  }

  function closeUsageLocationMenu(restoreFocus = false) {
    state.usageLocationMenuClose?.(restoreFocus);
  }

  function openWorkflowMenu(trigger, {id, label: menuLabel, choices, selected: selectedValue, select}) {
    closeUsageLocationMenu();
    if (!choices.length) return;
    const menu = div("no-drag z-50 m-px flex select-none flex-col overflow-y-auto bg-surface-elevated-secondary/90 text-default ring-border ring-[0.5px] shadow-xl-spread backdrop-blur-sm rounded-2xl p-[var(--app-menu-gutter,var(--spacing))] w-[240px]");
    menu.id = `codex-workflow-${id}-menu`;
    menu.dataset.codexWorkflow = `${id}-menu`;
    menu.dataset.state = "open";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-orientation", "vertical");
    menu.setAttribute("aria-label", menuLabel);
    menu.style.position = "fixed";
    menu.style.maxWidth = "calc(100vw - 16px)";
    menu.style.maxHeight = "calc(100vh - 16px)";
    const items = choices.map(({value, label: text, icon}) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "no-drag w-full outline-hidden flex min-h-[var(--app-menu-item-height,0px)] shrink-0 items-center justify-center rounded-xl p-[var(--app-menu-item-padding,var(--padding-row-y)_var(--padding-row-x))] text-sm text-default group hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover cursor-interaction";
      item.dataset.value = value;
      item.setAttribute("role", selectedValue === undefined ? "menuitem" : "menuitemradio");
      const selected = selectedValue === value;
      if (selectedValue !== undefined) item.setAttribute("aria-checked", String(selected));
      item.tabIndex = selected ? 0 : -1;
      const row = div("flex w-full min-w-0 items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]");
      const label = div("min-w-0 flex-1 truncate text-start");
      label.textContent = text;
      if (icon) row.append(icon);
      row.append(label);
      if (selected) {
        const check = workflowNativeGlyph("menu-check", "shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100");
        check.setAttribute("width", "16"); check.setAttribute("height", "16");
        row.append(check);
      }
      item.append(row);
      item.addEventListener("click", async () => {
        closeUsageLocationMenu(true);
        if (trigger.isConnected && !trigger.disabled && !state.settingsWriteInFlight && value !== selectedValue) {
          await select(value);
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
    (items.find((item) => item.getAttribute("aria-checked") === "true") || items[0]).focus({ preventScroll: true });
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

  function needsUsageData() {
    return state.settings.showUsageRemaining || state.settings.showContextUsage || state.settings.focusedInterface &&
      state.settings.sidebarNavigation.footerShortcut === "usage-shortcut";
  }

  async function syncUsageBridge() {
    if (!webFrame?.executeJavaScript || state.usageBridgeInFlight ||
      state.usageBridgeEnabled === needsUsageData()) return;
    const enabled = needsUsageData();
    state.usageBridgeInFlight = true;
    try {
      await webFrame.executeJavaScript(`(${installNativeUsageBridge.toString()})(${enabled})`);
      state.usageBridgeEnabled = enabled;
    } catch {
      state.usageData = null;
      updateUsageText();
    } finally {
      state.usageBridgeInFlight = false;
      if (enabled !== needsUsageData()) syncUsageBridge();
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
    const showIndicator = state.settings.showUsageRemaining || state.settings.showContextUsage;
    let owner = null;
    let anchor = null;
    let template = null;
    if (showIndicator && placement === "composer") {
      const buttons = Array.from(state.composerRoot?.querySelectorAll(
        '[data-composer-rows] button[data-composer-navigation-target="permissions"]',
      ) || []).filter(visibleUsageTarget);
      if (buttons.length === 1) {
        anchor = template = buttons[0];
        owner = anchor.parentElement;
      }
    } else if (showIndicator) {
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
      if (!needsUsageData()) state.usageData = null;
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
    classes.add("gap-1");
    if (placement === "toolbar") classes.add("px-1");
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

  function usageView(alertThreshold = state.settings.usageAlertThreshold, now = Date.now()) {
    let limits = selectUsageWindows(state.usageData, state.settings.usageWindow, now);
    if (!limits.length && state.settings.usageWindow !== "automatic") limits = selectUsageWindows(state.usageData, "automatic", now);
    limits = limits.map((limit) => ({
      ...limit,
      reset: state.settings.usageDisplay === "remaining-reset" ? formatUsageReset(limit.resetsAt, now) : null,
    }));
    const multiple = limits.length > 1;
    const text = limits.length ? limits.map((limit) =>
      `${multiple ? `${limit.shortLabel} ` : ""}${limit.remaining}%${state.settings.usageDisplay === "remaining-reset" ? ` left${limit.reset ? ` · resets in ${limit.reset}` : ""}` : ""}`
    ).join(" · ") : "—";
    const contextPercent = Number.isFinite(state.usageData?.contextPercent) &&
      state.usageData.contextPercent >= 0 && state.usageData.contextPercent <= 100
      ? Math.round(state.usageData.contextPercent) : null;
    return {
      now,
      limits,
      text,
      contextPercent,
      warning: state.settings.lowUsageAlert && limits.some((limit) => limit.remaining <= alertThreshold),
      label: limits.length ? limits.map((limit) => limit.label).join(" · ") : "Usage unavailable",
      usageAccessible: limits.length ? limits.map((limit) =>
        `${limit.label}: ${limit.remaining}% remaining${limit.reset ? `, resets in ${limit.reset}` : ""}`
      ).join(". ") : "Usage unavailable",
    };
  }

  function applyUsageValue(button, view, includeUsage, includeContext) {
    if (!button) return;
    const parts = [];
    if (includeUsage) parts.push({kind:"usage", text:view.text, warning:view.warning});
    if (includeContext) parts.push({kind:"context", text:`Context ${view.contextPercent == null ? "—" : `${view.contextPercent}%`}`});
    const signature = JSON.stringify(parts);
    if (button.dataset.codexWorkflowUsageValue !== signature) {
      button.dataset.codexWorkflowUsageValue = signature;
      button.replaceChildren();
      parts.forEach((part, index) => {
        if (index) {
          const separator = document.createElement("span");
          separator.className = "text-tertiary";
          separator.setAttribute("aria-hidden", "true");
          separator.textContent = "·";
          button.append(separator);
        }
        const text = document.createElement("span");
        text.dataset.codexWorkflowUsageText = part.kind;
        if (part.warning) text.className = "text-warning";
        text.textContent = part.text;
        button.append(text);
      });
    }
    const accessible = [];
    if (includeUsage) accessible.push(view.usageAccessible);
    if (includeContext) accessible.push(view.contextPercent == null ? "Context usage unavailable" : `Context usage: ${view.contextPercent}%`);
    const label = `${accessible.join(". ")}. Open Usage settings`;
    if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
  }

  function usageTooltipText(view) {
    const parts = [];
    if (state.settings.showUsageRemaining) parts.push(view.label);
    if (state.settings.showContextUsage) parts.push(`Context ${view.contextPercent == null ? "unavailable" : `${view.contextPercent}%`}`);
    return parts.join(" · ") || "Usage unavailable";
  }

  function updateUsageText(alertThreshold = state.settings.usageAlertThreshold) {
    clearTimeout(state.usageTextTimer);
    state.usageTextTimer = null;
    const view = usageView(alertThreshold);
    const footer = state.footerShortcut?.button;
    applyUsageValue(state.usageButton, view, state.settings.showUsageRemaining, state.settings.showContextUsage);
    if (footer?.dataset.shortcut === "usage-shortcut") {
      applyUsageValue(footer, view, true, false);
      if (footer.title !== view.label) footer.title = view.label;
    }
    const tooltip = usageTooltipText(view);
    if (state.usageTooltip && state.usageTooltip.textContent !== tooltip) state.usageTooltip.textContent = tooltip;
    state.settingControls.get("usageWindow")?.apply(state.settings.usageWindow);
    if (state.settings.usageDisplay === "remaining-reset" && view.limits.some((limit) => limit.resetsAt != null) &&
      (state.settings.showUsageRemaining && state.usageButton || footer?.dataset.shortcut === "usage-shortcut")) {
      const delays = view.limits.map((limit) => limit.resetsAt * 1000 - view.now).filter((delay) => delay > 0)
        .map((delay) => delay % 60000 || 60000);
      if (delays.length) state.usageTextTimer = setTimeout(updateUsageText, Math.max(100, Math.min(...delays) + 20));
    }
  }

  function showUsageTooltip() {
    hideUsageTooltip();
    const button = state.usageButton;
    if (!button?.isConnected) return;
    const tooltip = div("w-fit text-sm whitespace-normal break-words select-none z-50 rounded-2xl border border-default bg-surface-elevated-secondary text-default px-2 py-1.5 pointer-events-none");
    tooltip.id = "codex-workflow-usage-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.dataset.codexWorkflow = "usage-tooltip";
    tooltip.textContent = usageTooltipText(usageView());
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
      ? field : div("no-drag flex items-center py-0 text-base leading-[18px] h-8 gap-2 rounded-full border border-primary-outline bg-background-secondary-soft-alpha px-2.5");
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
    const icon = workflowNativeGlyph("search-clear");
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
    const activityBefore = [...state.conversationActivity].map(([button, saved]) => [button, saved, {...saved}, button.getAttribute("aria-expanded")]);
    const focusedControl = document.activeElement;
    const patch = key === "reset" ? {...defaults, sidebarNavigation:{...defaults.sidebarNavigation}} :
      key === "resetComposer" ? Object.fromEntries(composerSettingKeys.map(name => [name, defaults[name]])) :
      key === "resetConversation" ? Object.fromEntries(conversationSettingKeys.map(name => [name, defaults[name]])) :
      key === "resetUsage" ? Object.fromEntries(usageSettingKeys.map(name => [name, defaults[name]])) : {[key]:next};
    state.settings = { ...previous, ...patch };
    state.settingsWriteInFlight = true;
    if (state.status) state.status.textContent = "";
    refreshSettingControls();
    syncNavigation();
    syncAuxiliary();
    try {
      if (key === "sidebarNavigation" && state.page === "sidebar") refreshNavigationRows();
      state.settings = normaliseSettings(await ipcRenderer.invoke("codex-workflow:settings:set", patch));
    } catch (error) {
      state.settings = previous;
      for (const [button, original, before, expanded] of activityBefore) {
        if (!state.conversationRoot?.contains(button)) continue;
        let saved = state.conversationActivity.get(button);
        if (!saved) {
          saved = original;
          state.conversationActivity.set(button, saved);
          button.addEventListener("click", saved.listener);
        }
        saved.applying = true;
        try { if (button.getAttribute("aria-expanded") !== expanded) button.click(); }
        finally { Object.assign(saved, before); }
      }
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
    for (const control of state.navigationControls) {
      const full = control.hasAttribute("data-workflow-add-shortcut") && shortcutIds.every(id => state.settings.sidebarNavigation.order.includes(id));
      control.disabled = state.settingsWriteInFlight || !state.settings.focusedInterface || full;
      if (control.hasAttribute("data-workflow-add-shortcut")) control.title = full ? "All shortcuts added" : "Add shortcut";
    }
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
    const builtins = defaults.sidebarNavigation.order.filter(id => id !== "settings-shortcut");
    const sidebarItems = [...defaults.sidebarNavigation.order, "usage-shortcut", "whats-new-shortcut", "workflow-shortcut", "profile-shortcut"];
    const savedOrder = Array.isArray(sidebarNavigation.order) ? sidebarNavigation.order.slice(0, 100) : defaults.sidebarNavigation.order;
    const order = [...new Set([...savedOrder, ...(value?.schemaVersion >= 4 ? builtins : defaults.sidebarNavigation.order)]
      .map(id => id === "general-shortcut" ? "settings-shortcut" : id).filter(id => sidebarItems.includes(id)))];
    return {
      schemaVersion: 5,
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
      composerModelLabel: value?.composerModelLabel === "short" ? "short" : "full",
      composerReasoningLabel: value?.composerReasoningLabel === "compact" ? "compact" : "full",
      composerWidth: value?.composerWidth === "wide" ? "wide" : "default",
      conversationWidth: typeof value?.conversationWidth === "number" && Number.isFinite(value.conversationWidth)
        ? Math.min(1440, Math.max(480, Math.round(value.conversationWidth / 8) * 8)) : null,
      messageSpacing: ["compact", "relaxed"].includes(value?.messageSpacing) ? value.messageSpacing : "default",
      userMessageStyle: value?.userMessageStyle === "plain" ? "plain" : "bubble",
      toolActivity: value?.toolActivity === "expanded" ? "expanded" : "summary",
      showMessageTimestamps: value?.showMessageTimestamps === true,
      usageRemainingLocation: ["toolbar", "composer"].includes(value?.usageRemainingLocation) ? value.usageRemainingLocation : defaults.usageRemainingLocation,
      usageDisplay: ["remaining", "remaining-reset"].includes(value?.usageDisplay) ? value.usageDisplay : defaults.usageDisplay,
      usageWindow: ["automatic", "5h", "weekly", "monthly", "5h-weekly"].includes(value?.usageWindow) ? value.usageWindow : defaults.usageWindow,
      showContextUsage: value?.showContextUsage === true,
      lowUsageAlert: value?.lowUsageAlert === true,
      usageAlertThreshold: Number.isFinite(value?.usageAlertThreshold)
        ? Math.min(50, Math.max(1, Math.round(value.usageAlertThreshold)))
        : defaults.usageAlertThreshold,
      hiddenSettingsPages: Array.isArray(value?.hiddenSettingsPages)
        ? [...new Set(value.hiddenSettingsPages.slice(0, 100).filter((slug) =>
          typeof slug === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(slug) && slug !== "workflow"))]
        : [],
      sidebarNavigation: {
        order,
        footerShortcut: sidebarNavigation.footerShortcut === "general-shortcut" ? "settings-shortcut" :
          shortcutIds.includes(sidebarNavigation.footerShortcut) ? sidebarNavigation.footerShortcut : defaults.sidebarNavigation.footerShortcut,
        hidden: Array.isArray(sidebarNavigation?.hidden)
          ? [...new Set(sidebarNavigation.hidden.slice(0, 100).map(id => id === "general-shortcut" ? "settings-shortcut" : id).filter((item) => order.includes(item)))]
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
    scheduled: "Scheduled", plugins: "Plugins", explore: "Explore", "settings-shortcut": "Settings",
    "usage-shortcut": "Usage", "whats-new-shortcut": "What's New", "workflow-shortcut": "Workflow", "profile-shortcut": "Profile" };
  const shortcutIds = ["settings-shortcut", "usage-shortcut", "whats-new-shortcut", "workflow-shortcut", "profile-shortcut"];
  const accountNavigationLabels = {usage: "Usage", pet: "Show pet", invite: "Invite a friend", settings: "Settings", logout: "Log out"};
  const iconButtonClass = "no-drag flex size-6 shrink-0 items-center justify-center rounded-full cursor-interaction hover:bg-primary-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40";
  // Native Tabs page variant: tabs-bd1cb7e26bf5.js (staging), tabs-a1458634b2c1.js (installed).
  const segmentClass = "no-drag cursor-interaction items-center text-sm select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 flex min-w-0 gap-1.5 rounded-md px-2 py-1 font-medium shrink-0 whitespace-nowrap";

  function redrawWorkflowPanel() {
    closeUsageLocationMenu();
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

  function renderAddShortcutButton() {
    const button = renderActionButton("Add shortcut");
    button.append(navigationGlyph("plus"));
    button.dataset.workflowAddShortcut = "true";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const open = event => {
      event.preventDefault();
      if (button.disabled || state.settingsWriteInFlight) return;
      if (button.getAttribute("aria-expanded") === "true") return closeUsageLocationMenu(true);
      openWorkflowMenu(button, {
        id: "add-shortcut", label: "Add shortcut",
        choices: shortcutIds.filter(id => !state.settings.sidebarNavigation.order.includes(id))
          .map(value => ({value, label: appNavigationLabels[value], icon: shortcutGlyph(value)})),
        select: async id => {
          await navigationUpdate({order: [...state.settings.sidebarNavigation.order, id]});
          if (button.disabled) state.panel?.querySelector(`[data-workflow-navigation-item="${id}"] button`)?.focus({preventScroll:true});
        },
      });
    };
    button.addEventListener("click", open);
    button.addEventListener("keydown", event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) open(event); });
    state.navigationControls.push(button);
    return button;
  }

  function shortcutGlyph(id) {
    if (id === "settings-shortcut") return nativeSettingsGlyph();
    if (id === "workflow-shortcut") {
      const root = document.createElement("span");
      root.append(navigationGlyph("eye"));
      replaceNavIcon(root);
      return root.firstElementChild;
    }
    if (id === "profile-shortcut") return workflowNativeGlyph("profile");
    return navigationGlyph(id === "usage-shortcut" ? "gauge" : "help");
  }

  function activateSidebarShortcut(id, anchor) {
    if (id === "whats-new-shortcut") {
      const sidebar = state.navigationRoot?.closest(".app-shell-left-panel");
      const buttons = [...(sidebar?.querySelectorAll('button[aria-label="Open help menu"]') || [])];
      anchor ||= sidebar?.querySelector('[data-workflow-shortcut][data-workflow-native-nav="whats-new-shortcut"]');
      if (buttons.length === 1 && anchor) openWhatsNewPopup(buttons[0], anchor);
      return;
    }
    restoreNativeSettingsView();
    state.pendingWorkflowShortcut = false;
    if (id === "workflow-shortcut") {
      state.page = "home";
      if (state.customNav?.isConnected) { state.customNav.click(); return; }
      state.pendingWorkflowShortcut = true;
    }
    if (id === "settings-shortcut") {
      beginDiscovery();
      ipcRenderer.invoke("codex-workflow:settings:activate", {target:"keyboard-shortcut"})
        .catch(error => log("error", error.message));
      return;
    }
    const path = id === "usage-shortcut" ? "/settings/usage" : id === "profile-shortcut" ? "/settings/profile" :
      id === "workflow-shortcut" ? "/settings/general-settings" : null;
    if (path) window.dispatchEvent(new MessageEvent("message", {data: {type:"navigate-to-route", path}}));
    beginDiscovery();
  }

  function openWhatsNewPopup(trigger, anchor) {
    if (state.whatsNewPopup?.anchor === anchor) { state.whatsNewPopup.close(); return; }
    state.whatsNewPopup?.close();
    let popup, saved, applied = {}, x = 0, y = 0, timer;
    const pointerEvents = anchor.style.pointerEvents;
    const close = () => {
      popup?.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", code:"Escape", bubbles:true, cancelable:true}));
      release();
      if (anchor.isConnected) anchor.focus({preventScroll:true});
      requestAnimationFrame(() => { if (!state.whatsNewPopup && anchor.isConnected) anchor.focus({preventScroll:true}); });
    };
    // Keep the owning trigger clickable through Radix's modal outside-pointer guard.
    const retainToggle = event => {
      if (anchor.contains(event.target)) { event.preventDefault(); event.stopPropagation(); }
    };
    const properties = ["translate", "width", "max-width", "max-height", "transform-origin"];
    const restore = () => {
      if (!popup) return;
      for (const key of properties) {
        if (popup.style.getPropertyValue(key) !== applied[key]) continue;
        const [value, priority] = saved[key];
        if (value) popup.style.setProperty(key, value, priority);
        else popup.style.removeProperty(key);
      }
      popup.removeAttribute("data-workflow-news-popup");
    };
    const release = () => {
      clearTimeout(timer); discovery.disconnect(); mounted.disconnect(); resize?.disconnect();
      window.removeEventListener("resize", align);
      document?.removeEventListener("scroll", align, true);
      document?.removeEventListener("pointerdown", retainToggle, true);
      anchor.style.pointerEvents = pointerEvents;
      anchor.setAttribute("aria-expanded", "false");
      anchor.dataset.state = "closed";
      restore();
      if (state.whatsNewPopup?.release === release) state.whatsNewPopup = null;
      if (document?.activeElement === trigger && anchor.isConnected) anchor.focus({preventScroll:true});
    };
    const write = (key, value) => {
      applied[key] = value;
      if (popup.style.getPropertyValue(key) !== value) popup.style.setProperty(key, value);
    };
    const align = () => {
      if (!popup?.isConnected || !anchor.isConnected) { release(); return; }
      const rect = anchor.getBoundingClientRect();
      if (!rect.width || !rect.height) { release(); return; }
      const footer = anchor.hasAttribute("data-workflow-footer-shortcut");
      const horizontal = footer ? state.navigationRoot?.querySelector("button.sidebar-item")?.getBoundingClientRect() || rect : rect;
      const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spacing")) || 4;
      const edge = gap * 2;
      write("width", `${horizontal.width}px`);
      write("max-width", `${innerWidth - edge * 2}px`);
      const below = innerHeight - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const down = footer ? above < below : popup.scrollHeight <= below || below >= above;
      write("max-height", `${Math.max(0, down ? below : above)}px`);
      const bounds = popup.getBoundingClientRect();
      const left = Math.max(edge, Math.min(horizontal.left, innerWidth - bounds.width - edge));
      const top = down ? rect.bottom + gap : rect.top - bounds.height - gap;
      x += left - bounds.left; y += Math.max(edge, top) - bounds.top;
      write("translate", `${x}px ${y}px`);
      write("transform-origin", down ? "top left" : "bottom left");
    };
    const mounted = new MutationObserver(() => {
      if (!popup?.isConnected || !anchor.isConnected) release();
    });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(align) : null;
    const discover = () => {
      const menus = [...document.querySelectorAll('[role="menu"]')].filter(menu =>
        trigger.id && menu.getAttribute("aria-labelledby") === trigger.id && !menu.closest('[cmdk-root]'));
      if (menus.length !== 1) return;
      popup = menus[0];
      saved = Object.fromEntries(properties.map(key => [key, [popup.style.getPropertyValue(key), popup.style.getPropertyPriority(key)]]));
      popup.dataset.workflowNewsPopup = "true";
      discovery.disconnect(); clearTimeout(timer);
      for (let parent = popup.parentElement; parent; parent = parent.parentElement) {
        mounted.observe(parent, {childList:true});
        if (parent === document.body) break;
      }
      resize?.observe(popup); resize?.observe(anchor);
      window.addEventListener("resize", align);
      document.addEventListener("scroll", align, true);
      align();
      requestAnimationFrame(() => { if (state.whatsNewPopup?.release === release) align(); });
    };
    const discovery = new MutationObserver(discover);
    state.whatsNewPopup = {anchor, release, close};
    anchor.style.pointerEvents = "auto";
    anchor.setAttribute("aria-expanded", "true");
    anchor.dataset.state = "open";
    document.addEventListener("pointerdown", retainToggle, true);
    discovery.observe(document.body, {childList:true, subtree:true});
    timer = setTimeout(release, 1500);
    // Native Radix trigger opens on ArrowDown, not a synthetic click.
    if (trigger.getAttribute("aria-expanded") !== "true") {
      trigger.focus({preventScroll:true});
      trigger.dispatchEvent(new KeyboardEvent("keydown", {
        key:"ArrowDown", code:"ArrowDown", bubbles:true, cancelable:true, composed:true,
      }));
    }
    discover();
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
    const account = findSettingsAccountButton(state.settingsNav);
    if (account) nodes.push(account);
    const parentOf = node => node === account ? node.parentElement?.parentElement : node.parentElement;
    const groups = [...new Set(nodes.map(parentOf))];
    return groups.flatMap((parent, index) => nodes.filter(node => parentOf(node) === parent)
      .map((node, position) => ({id: node === account ? "account" : node.dataset.settingsPanelSlug,
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
    const shapes = kind === "plus" ? [["path",{d:"M5 12h14"}], ["path",{d:"M12 5v14"}]] :
      kind === "gauge" ? [["path",{d:"m12 14 4-4"}], ["path",{d:"M3.34 19a10 10 0 1 1 17.32 0"}]] :
      kind === "help" ? [["circle",{cx:12,cy:12,r:10}], ["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}], ["path",{d:"M12 17h.01"}]] :
      kind === "trash" ? [["path",{d:"M3 6h18"}], ["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"}], ["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"}], ["line",{x1:10,x2:10,y1:11,y2:17}], ["line",{x1:14,x2:14,y1:11,y2:17}]] :
      kind === "back" ? [["path", {d:"m15 18-6-6 6-6"}]] :
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

  function nativeSettingsGlyph() { return workflowNativeGlyph("settings"); }

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
      button.className = `${segmentClass} ${selected ? "text-default bg-segmented-selected enabled:hover:bg-segmented-selected-hover data-[state=open]:bg-segmented-selected-hover border-transparent" : "text-tertiary enabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border-transparent"}`;
      button.setAttribute("aria-pressed", String(selected));
      button.textContent = label;
      button.addEventListener("click", () => { state.navigationTab = id; redrawWorkflowPanel(); });
      tabs.append(button);
    }
    header.append(tabs);
    const section = sectionHeading("Navigation items");
    if (state.navigationTab === "app") section.firstElementChild.append(renderAddShortcutButton());
    const card = settingsCard();
    card.dataset.codexWorkflowNavigationRows = "true";
    section.append(card);
    page.append(header, section);
    populateNavigationRows(card);
    if (state.navigationTab === "account") {
      const shortcutCard = settingsCard(); shortcutCard.classList.add("mt-8");
      const row = div("flex items-center justify-between px-4 gap-6 py-3");
      const copy = div("flex min-w-0 flex-1 flex-col gap-0.5");
      const title = div("min-w-0 text-sm text-default font-medium"); title.textContent = "Footer shortcut";
      const detail = div("min-w-0 text-xs leading-4 text-balance text-secondary");
      detail.id = "codex-workflow-footer-shortcut-description";
      detail.textContent = "Choose the shortcut beside your account.";
      copy.append(title, detail);
      const {button, label} = nativeMenuButton();
      button.setAttribute("aria-label", "Footer shortcut"); button.setAttribute("aria-describedby", detail.id);
      const apply = prefs => label.replaceChildren(shortcutGlyph(prefs.footerShortcut), document.createTextNode(appNavigationLabels[prefs.footerShortcut]));
      const applyDisabled = busy => { button.disabled = busy || !state.settings.focusedInterface; if (button.disabled) closeUsageLocationMenu(); };
      state.settingControls.set("sidebarNavigation", {button, apply, applyDisabled});
      const open = event => {
        event.preventDefault();
        if (button.disabled) return;
        if (state.usageLocationMenuClose) { closeUsageLocationMenu(true); return; }
        openWorkflowMenu(button, {id:"footer-shortcut", label:"Footer shortcut", selected:state.settings.sidebarNavigation.footerShortcut,
          choices:shortcutIds.map(value => ({value, label:appNavigationLabels[value], icon:shortcutGlyph(value)})),
          select:value => navigationUpdate({footerShortcut:value})});
      };
      button.addEventListener("click", open);
      button.addEventListener("keydown", event => { if (["ArrowUp", "ArrowDown"].includes(event.key)) open(event); });
      row.append(copy, button); shortcutCard.append(row); page.append(shortcutCard);
    }
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
    const footerCopy = div("flex min-w-0 flex-col gap-1");
    footerCopy.append(renderVersionLabel(), state.status);
    footer.append(footerCopy, reset); page.append(footer);
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
      const icon = state.navigationTab === "app" && shortcutIds.includes(item.id)
        ? shortcutGlyph(item.id) : state.icons.get(`${state.navigationTab}:${item.id}`);
      if (icon) {
        const clone = icon.cloneNode(true); scrubSidebarClone(clone);
        // Native animated SVGs use absolute/size-full inside a wrapper (build 8881).
        clone.setAttribute("class", "icon-sm shrink-0");
        left.append(clone);
      }
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
      if (state.navigationTab === "app") {
        if (shortcutIds.includes(item.id)) {
          const remove = document.createElement("button");
          remove.type = "button"; remove.className = iconButtonClass;
          remove.setAttribute("aria-label", `Remove ${item.label} shortcut`);
          remove.title = `Remove ${item.label} shortcut`;
          remove.append(navigationGlyph("trash"));
          remove.addEventListener("click", async () => {
            const prefs = state.settings.sidebarNavigation;
            await navigationUpdate({order:prefs.order.filter(id => id !== item.id), hidden:prefs.hidden.filter(id => id !== item.id)});
            if (!remove.isConnected) state.panel?.querySelector('[data-workflow-add-shortcut]')?.focus({preventScroll:true});
          });
          state.navigationControls.push(remove); controls.insertBefore(remove, controls.lastElementChild);
        }
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

  function findSettingsAccountButton(nav) {
    const matches = [...(nav?.querySelectorAll("span.contents > button.sidebar-item:not([data-settings-panel-slug])") || [])]
      .filter(node => node.getAttribute("aria-label") === "Account");
    return matches.length === 1 ? matches[0] : null;
  }

  function syncSettingsAccountNavigation() {
    for (const nav of document.querySelectorAll('nav.sidebar-navigation[aria-label="Settings"]')) {
      const account = findSettingsAccountButton(nav);
      for (const node of nav.querySelectorAll('[data-workflow-settings-native-nav="account"]')) {
        if (node !== account && node !== account?.parentElement) node.removeAttribute("data-workflow-settings-native-nav");
      }
      if (!account) continue;
      markNavigation(account, "data-workflow-settings-native-nav", "account");
      markNavigation(account.parentElement, "data-workflow-settings-native-nav", "account");
      rememberIcon("settings", "account", account);
    }
  }

  function syncNavigation() {
    if (!document?.documentElement) return;
    syncSettingsAccountNavigation();
    const prefs = state.settings.sidebarNavigation;
    const enabled = state.settings.focusedInterface;
    if (state.whatsNewPopup && (!enabled || !state.whatsNewPopup.anchor.isConnected ||
      (!state.whatsNewPopup.anchor.hasAttribute("data-workflow-footer-shortcut") &&
      (!prefs.order.includes("whats-new-shortcut") || prefs.hidden.includes("whats-new-shortcut"))))) state.whatsNewPopup.close();
    const scope = 'aside.app-shell-left-panel #app-shell-sidebar';
    const rules = enabled ? [`${scope} [data-workflow-nav-flatten]{display:contents!important;}`] : [];
    if (enabled) {
      // Build 7982: even the native width token can differ from the rendered sidebar.
      rules.push('[role="menu"][data-workflow-account-sizing]{width:calc(var(--codex-workflow-account-sidebar-width) - 2 * var(--padding-row-cell-x, var(--padding-row-x)))!important;}');
      prefs.order.forEach((id, index) => rules.push(`${scope} [data-workflow-native-nav="${id}"]{order:${index + 1}!important;}`));
      prefs.hidden.forEach(id => rules.push(`${scope} [data-workflow-native-nav="${id}"]{display:none!important;}`));
      if (!prefs.showRecentChats) rules.push(`${scope} section[data-app-action-sidebar-section-heading="Recents"]{display:none!important;}`);
      // Native floating panels wrap Settings during sidebar transitions (build 8576).
      const settingsScope = ':is(.app-shell-left-panel, [data-testid="app-shell-floating-left-panel"]) nav.sidebar-navigation[aria-label="Settings"]:not([role="dialog"] *, [role="menu"] *, [cmdk-root] *, .vertical-scroll-fade-mask *)';
      const settingsItemSelector = id => id === "account"
        ? '[data-workflow-settings-native-nav="account"]'
        : `button[data-settings-panel-slug="${id}"]`;
      prefs.settingsHidden.forEach(id => rules.push(`${settingsScope} ${settingsItemSelector(id)}:not(:disabled){display:none!important;}`));
      if (prefs.settingsHidden.length) {
        const visible = prefs.settingsHidden.map(id => `:not([data-settings-panel-slug="${id}"])`).join("");
        const visibleAccount = prefs.settingsHidden.includes("account") ? "" : ', [data-workflow-settings-native-nav="account"]';
        // A section can mount before its rows. Keep empty headings hidden too,
        // but preserve disabled rows, extension content and header actions.
        rules.push(`${settingsScope} .flex.flex-col.gap-1:has(> .group\\/nav-section-title):has(> .flex.flex-col):not(:has(> :not(.group\\/nav-section-title, .flex.flex-col))):not(:has(> .flex.flex-col > :not(button[data-settings-panel-slug]:not(:disabled), [data-workflow-settings-native-nav="account"]))):not(:has(> .flex.flex-col > :is(button${visible}${visibleAccount}))):not(:has(.group\\/nav-section-title button)){display:none!important;}`);
      }
      // Give unlisted native rows a trailing fallback before applying saved order.
      if (prefs.settingsOrder.length) rules.push(`${settingsScope} :where(.flex.flex-col:has(> button[data-settings-panel-slug]) > *, .contents > button.sidebar-item:not([data-settings-panel-slug])){order:101!important;}`);
      prefs.settingsOrder.forEach((id,index) => rules.push(`${settingsScope} ${settingsItemSelector(id)}{order:${index + 1}!important;}`));
      prefs.accountHidden.forEach(id => rules.push(`[role="menu"][data-workflow-account-menu] [data-workflow-account-item="${id}"]{display:none!important;}`));
      prefs.accountOrder.forEach((id,index) => {
        rules.push(`[role="menu"][data-workflow-account-menu] [data-workflow-account-item="${id}"]{order:${index + 1}!important;}`);
        rules.push(`[role="menu"][data-workflow-account-menu] [data-workflow-account-separator="${id}"]{order:${index + 1.5}!important;}`);
      });
    }
    if (!state.navigationStyle) { state.navigationStyle = document.createElement("style"); state.navigationStyle.dataset.codexWorkflowNavigationStyle = "true"; document.documentElement.append(state.navigationStyle); }
    const css = rules.join("\n");
    const activeSettings = document.activeElement?.closest?.("[data-settings-panel-slug], [data-workflow-settings-native-nav]");
    const activeSettingsId = activeSettings?.dataset.settingsPanelSlug || activeSettings?.dataset.workflowSettingsNativeNav;
    if (enabled && prefs.settingsHidden.includes(activeSettingsId)) state.customNav?.focus();
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
        for (const id of shortcutIds) {
          let shortcut = group.querySelector(`[data-workflow-shortcut][data-workflow-native-nav="${id}"]`);
          if (!enabled || !prefs.order.includes(id)) {
            if (shortcut?.contains(document.activeElement)) rows.get("new-chat")?.focus();
            shortcut?.remove();
            continue;
          }
          if (shortcut) continue;
          shortcut = rows.get("pull-requests").cloneNode(true); scrubSidebarClone(shortcut);
          shortcut.removeAttribute("aria-current"); shortcut.removeAttribute("aria-selected");
          shortcut.dataset.workflowShortcut = "true"; shortcut.dataset.workflowNativeNav = id;
          replaceLabelText(shortcut,appNavigationLabels[id]); shortcut.setAttribute("aria-label",appNavigationLabels[id]);
          shortcut.querySelector("svg")?.replaceWith(shortcutGlyph(id));
          if (id === "whats-new-shortcut") {
            shortcut.setAttribute("aria-haspopup", "menu"); shortcut.setAttribute("aria-expanded", "false");
          }
          shortcut.addEventListener("click", () => activateSidebarShortcut(id));
          group.append(shortcut);
        }
      }
      const active = document.activeElement;
      if (root.contains(active) && getComputedStyle(active).display === "none") rows.get("new-chat")?.focus();
      const recent = root.querySelector('section[data-app-action-sidebar-section-heading="Recents"]');
      if (enabled && !prefs.showRecentChats && recent?.contains(active)) rows.get("new-chat")?.focus();
    }
    for (const node of document.querySelectorAll('nav[aria-label="Settings"] button[data-settings-panel-slug]')) {
      rememberIcon("settings",node.dataset.settingsPanelSlug,node);
    }
    syncFooterShortcut();
    syncAccountNavigation();
  }

  function syncFooterShortcut() {
    const trigger = state.navigationRoot?.closest(".app-shell-left-panel")?.querySelector('button[aria-label="Open help menu"]');
    const current = state.footerShortcut;
    if (current && (current.trigger !== trigger || !current.button.isConnected || !state.settings.focusedInterface)) {
      if (state.whatsNewPopup?.anchor === current.button) state.whatsNewPopup.close();
      current.button.remove(); current.trigger.style.display = current.display;
      state.footerShortcut = null;
    }
    if (!trigger || !state.settings.focusedInterface) return;
    if (!state.footerShortcut) {
      const button = trigger.cloneNode(true); scrubSidebarClone(button);
      button.removeAttribute("id"); button.removeAttribute("aria-controls");
      button.dataset.workflowFooterShortcut = "true";
      button.setAttribute("aria-expanded", "false"); button.dataset.state = "closed";
      state.footerShortcut = {trigger, button, display:trigger.style.display};
      state.navigationObserver?.observe(trigger.parentElement, {childList:true});
      trigger.style.display = "none"; trigger.after(button);
      button.addEventListener("click", () => activateSidebarShortcut(state.settings.sidebarNavigation.footerShortcut, button));
      button.addEventListener("keydown", event => {
        if (state.settings.sidebarNavigation.footerShortcut === "whats-new-shortcut" && ["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault(); activateSidebarShortcut("whats-new-shortcut", button);
        }
      });
    }
    const {button} = state.footerShortcut;
    const id = state.settings.sidebarNavigation.footerShortcut;
    if (button.dataset.shortcut === id) {
      if (id === "usage-shortcut") updateUsageText();
      return;
    }
    if (state.whatsNewPopup?.anchor === button) state.whatsNewPopup.close();
    button.dataset.shortcut = id;
    button.setAttribute("aria-label", appNavigationLabels[id]); button.title = appNavigationLabels[id];
    if (id === "whats-new-shortcut") button.setAttribute("aria-haspopup", "menu");
    else button.removeAttribute("aria-haspopup");
    button.className = trigger.className;
    button.replaceChildren(shortcutGlyph(id));
    if (id === "usage-shortcut") {
      // Native footer is size-8; retain its height/focus states, allow 100% width.
      button.classList.remove("size-8", "aspect-square", "!px-0");
      button.classList.add("h-8", "px-1", "tabular-nums", "text-sm", "leading-[18px]");
      updateUsageText();
    }
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
    if (state.pendingWorkflowShortcut) {
      state.pendingWorkflowShortcut = false;
      custom.click();
    }

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
    const item = target?.closest("[data-settings-panel-slug], [data-workflow-settings-native-nav], [data-list-navigation-item], [data-codex-workflow='nav-item']");
    if (!item || item === state.customNav) return;
    state.pendingWorkflowShortcut = false;
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

  function renderSettingRow({ key, label, description, requiresFocusedInterface = false }) {
    const row = renderControlRow({ key, label, description });
    row.lastElementChild.appendChild(renderSwitch({
      key,
      labelId: `codex-workflow-${key}-label`,
      descriptionId: `codex-workflow-${key}-description`,
      requiresFocusedInterface,
    }));
    return row;
  }

  // Shared copy and control slot; callers construct only the control they need.
  function renderControlRow({ key, label: labelText, description: descriptionText }) {
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
    thumb.className = "rounded-full border border-control-thumb-on-accent bg-control-thumb-on-accent shadow-sm transition-transform duration-basic ease-out data-[state=unchecked]:translate-x-0 h-4 w-4 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[14px] rtl:data-[state=unchecked]:-translate-x-[2px] rtl:data-[state=checked]:-translate-x-[14px]";
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
