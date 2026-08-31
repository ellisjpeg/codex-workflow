"use strict";

const { ipcRenderer } = require("electron");

function isTopFrame() {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

if (!globalThis.__codexWorkflowPreloadInstalled && isTopFrame()) {
  globalThis.__codexWorkflowPreloadInstalled = true;

  const defaults = {
    schemaVersion: 2,
    focusedInterface: true,
    hidePullRequests: true,
    hidePetMenuItem: true,
    hideInviteFriendMenuItem: true,
  };
  const discoveryDelays = [16, 50, 150, 450, 1000];
  const discoveryRootSelector = ".app-shell-left-panel, nav[aria-label='Settings'], [data-settings-panel-slug='general-settings']";
  const state = {
    settings: { ...defaults },
    discoveryObserver: null,
    discoveryTimer: null,
    discoveryAttempt: 0,
    sidebarObserver: null,
    sidebarMountObservers: [],
    sidebarRoot: null,
    settingsObserver: null,
    settingsMountObservers: [],
    settingsShell: null,
    accountMenuDiscoveryObserver: null,
    accountMenuDiscoveryTimer: null,
    scheduled: false,
    dirty: { discovery: false, sidebar: false, settings: false, toolbar: false },
    updateStatus: { available: false, installedVersion: null, availableVersion: null },
    updateApplying: false,
    updatePill: null,
    updatePillSlot: null,
    customNav: null,
    settingsNav: null,
    panel: null,
    contentArea: null,
    activeWorkflow: false,
    workflowEntryLocation: null,
    workflowNativeSlug: null,
    nativeSnapshot: null,
    customInactiveSnapshot: null,
    navWithListener: null,
    loggedSettingsShell: false,
    hiddenPullRequestCount: -1,
    hiddenPetMenuItemCount: -1,
    hiddenInviteFriendMenuItemCount: -1,
    loggedAmbiguousPetMenu: false,
    loggedAmbiguousInviteFriendMenu: false,
    customizationOpen: false,
    customizationSection: null,
    settingsWriteInFlight: false,
    settingControls: new Map(),
  };

  queueMicrotask(waitForCodexRenderer);

  function isCodexRenderer() {
    return location.protocol === "app:";
  }

  function waitForCodexRenderer() {
    if (isCodexRenderer()) {
      start();
      return;
    }
    let checks = 0;
    const timer = setInterval(() => {
      checks += 1;
      if (isCodexRenderer()) {
        clearInterval(timer);
        start();
      } else if (checks >= 200) {
        clearInterval(timer);
      }
    }, 25);
  }

  async function start() {
    try {
      state.settings = normaliseSettings(
        await ipcRenderer.invoke("codex-workflow:settings:get"),
      );
    } catch (error) {
      log("error", `settings read failed: ${error?.stack || error}`);
    }
    try {
      state.updateStatus = await ipcRenderer.invoke("codex-workflow:update:get");
    } catch (error) {
      log("error", `update status read failed: ${error?.stack || error}`);
    }
    ipcRenderer.on?.("codex-workflow:update:status", (_event, status) => {
      state.updateStatus = status || { available: false };
      state.updateApplying = false;
      scheduleWork("toolbar");
    });

    const boot = () => {
      installHistoryHooks();
      installDiscoveryHooks();
      beginDiscovery();
      log("info", "preload started");
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }

  function normaliseSettings(value) {
    const legacyFocusedInterface = typeof value?.efficiencyMode === "boolean"
      ? value.efficiencyMode
      : defaults.focusedInterface;
    return {
      schemaVersion: 2,
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
    };
  }

  function installHistoryHooks() {
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) {
        const previousLocation = location.href;
        const result = original.apply(this, args);
        if (state.activeWorkflow && location.href !== previousLocation) restoreNativeSettingsView();
        beginDiscovery();
        scheduleWork("sidebar", "settings", "toolbar");
        return result;
      };
    }
    const onNavigation = () => {
      if (state.activeWorkflow) restoreNativeSettingsView();
      beginDiscovery();
      scheduleWork("sidebar", "settings", "toolbar");
    };
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);
  }

  function installDiscoveryHooks() {
    document.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.ctrlKey) return;
      const target = accountMenuTriggerFromEvent(event);
      if (target) beginAccountMenuDiscovery();
    }, true);
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest("button, a, [role='button'], [role='menuitem']")
        : null;
      if (!target) return;
      const label = compactText(target.getAttribute("aria-label") || target.textContent);
      if (label === "settings" || label === "open settings") beginDiscovery();
      if (event.detail === 0 && accountMenuTriggerFromEvent(event)) {
        beginAccountMenuDiscovery();
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") beginDiscovery();
      if (["Enter", " ", "ArrowDown"].includes(event.key) && accountMenuTriggerFromEvent(event)) {
        beginAccountMenuDiscovery();
      }
    }, true);
  }

  function accountMenuTriggerFromEvent(event) {
    const target = event.target instanceof Element
      ? event.target.closest("button, [role='button']")
      : null;
    return target?.matches('[aria-haspopup="menu"]') && target.closest(".app-shell-left-panel")
      ? target
      : null;
  }

  function scheduleWork(...kinds) {
    for (const kind of kinds) state.dirty[kind] = true;
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      const dirty = state.dirty;
      state.dirty = { discovery: false, sidebar: false, settings: false, toolbar: false };
      if (dirty.discovery) discoverRoots();
      if (dirty.sidebar) syncPullRequests();
      if (dirty.settings) syncSettingsPage();
      if (dirty.toolbar) syncUpdatePill();
    });
  }

  function beginAccountMenuDiscovery() {
    stopAccountMenuDiscovery();
    state.accountMenuDiscoveryObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationMayContainAccountMenu)) syncAccountMenuItems();
    });
    state.accountMenuDiscoveryObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["role"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    state.accountMenuDiscoveryTimer = setTimeout(stopAccountMenuDiscovery, 1500);
    syncAccountMenuItems();
  }

  function stopAccountMenuDiscovery() {
    state.accountMenuDiscoveryObserver?.disconnect();
    state.accountMenuDiscoveryObserver = null;
    if (state.accountMenuDiscoveryTimer != null) clearTimeout(state.accountMenuDiscoveryTimer);
    state.accountMenuDiscoveryTimer = null;
  }

  function mutationMayContainAccountMenu(mutation) {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target?.parentElement;
    if (target?.closest?.('[role="menu"]')) return true;
    return Array.from(mutation.addedNodes || []).some((node) => {
      if (!(node instanceof Element)) return false;
      return node.matches('[role="menu"], [role="menuitem"]') ||
        Boolean(node.querySelector('[role="menu"], [role="menuitem"]'));
    });
  }

  function beginDiscovery() {
    state.discoveryAttempt = 0;
    if (state.discoveryTimer != null) {
      clearTimeout(state.discoveryTimer);
      state.discoveryTimer = null;
    }
    if (!state.discoveryObserver) {
      state.discoveryObserver = new MutationObserver((mutations) => {
        if (mutations.some(mutationMayContainRoot)) scheduleWork("discovery");
      });
      state.discoveryObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    scheduleWork("discovery");
  }

  function stopDiscovery() {
    state.discoveryObserver?.disconnect();
    state.discoveryObserver = null;
    if (state.discoveryTimer != null) clearTimeout(state.discoveryTimer);
    state.discoveryTimer = null;
    state.discoveryAttempt = 0;
  }

  function discoverRoots() {
    const sidebarRoot = findSidebarRoot();
    if (sidebarRoot) bindSidebarRoot(sidebarRoot);
    else if (state.sidebarRoot && !state.sidebarRoot.isConnected) unbindSidebarRoot();

    const settingsShell = findSettingsShell();
    if (settingsShell) bindSettingsShell(settingsShell);
    else if (state.settingsShell && !state.settingsShell.isConnected) unbindSettingsShell();

    if (state.sidebarRoot?.isConnected && state.settingsShell?.isConnected) {
      stopDiscovery();
      return;
    }

    if (state.discoveryAttempt >= discoveryDelays.length) {
      stopDiscovery();
      return;
    }
    const delay = discoveryDelays[state.discoveryAttempt];
    state.discoveryAttempt += 1;
    state.discoveryTimer = setTimeout(() => {
      state.discoveryTimer = null;
      scheduleWork("discovery");
    }, delay);
  }

  function mutationMayContainRoot(mutation) {
    return Array.from(mutation.addedNodes || []).some((node) => {
      if (!(node instanceof Element)) return false;
      return node.matches(discoveryRootSelector) || Boolean(node.querySelector(discoveryRootSelector));
    });
  }

  function findSidebarRoot() {
    const panels = Array.from(document.querySelectorAll(".app-shell-left-panel"));
    const panel = panels.find(isSidebarRoot);
    if (panel) return panel;

    const pullRequest = findPullRequestRows(document)[0];
    const owner = pullRequest?.closest(
      ".app-shell-left-panel, .vertical-scroll-fade-mask, [class*='w-token-sidebar']",
    );
    return isSidebarRoot(owner) ? owner : null;
  }

  function isSidebarRoot(element) {
    return element instanceof HTMLElement &&
      element.isConnected &&
      !element.closest('[role="dialog"], [role="menu"], [cmdk-root]');
  }

  function bindSidebarRoot(root) {
    if (state.sidebarRoot === root && root.isConnected) return;
    unbindSidebarRoot();
    state.sidebarRoot = root;
    state.sidebarObserver = new MutationObserver(() => {
      scheduleWork("sidebar", "toolbar");
    });
    state.sidebarObserver.observe(root, { childList: true, subtree: true });
    state.sidebarMountObservers = observeMountChain("sidebar", root);
    scheduleWork("sidebar", "toolbar");
  }

  function unbindSidebarRoot() {
    state.sidebarObserver?.disconnect();
    state.sidebarObserver = null;
    disconnectObservers(state.sidebarMountObservers);
    state.sidebarMountObservers = [];
    state.updatePillSlot?.remove();
    state.updatePillSlot = null;
    state.updatePill = null;
    state.sidebarRoot = null;
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

  function bindSettingsShell(shell) {
    if (state.settingsShell === shell && shell.isConnected) return;
    unbindSettingsShell();
    state.settingsShell = shell;
    state.settingsObserver = new MutationObserver(() => {
      scheduleWork("settings");
    });
    state.settingsObserver.observe(shell, { childList: true, subtree: true });
    state.settingsMountObservers = observeMountChain("settings", shell);
    scheduleWork("settings");
  }

  function unbindSettingsShell() {
    state.settingsObserver?.disconnect();
    state.settingsObserver = null;
    disconnectObservers(state.settingsMountObservers);
    state.settingsMountObservers = [];
    state.settingsShell = null;
    releaseSettingsMount();
  }

  function observeMountChain(kind, root) {
    const observers = [];
    let child = root;
    while (child?.parentElement) {
      const parent = child.parentElement;
      const observer = new MutationObserver(() => {
        if (root.isConnected) return;
        if (kind === "sidebar" && state.sidebarRoot === root) unbindSidebarRoot();
        if (kind === "settings" && state.settingsShell === root) unbindSettingsShell();
        beginDiscovery();
      });
      observer.observe(parent, { childList: true });
      observers.push(observer);
      if (parent === document.body) break;
      child = parent;
    }
    return observers;
  }

  function disconnectObservers(observers) {
    for (const observer of observers) observer.disconnect();
  }

  function syncPullRequests() {
    const root = state.sidebarRoot;
    if (!root?.isConnected) {
      if (root) unbindSidebarRoot();
      beginDiscovery();
      return;
    }
    const matching = findPullRequestRows(root);
    const candidates = new Set([
      ...matching,
      ...root.querySelectorAll('[data-codex-workflow-pr-hidden="true"]'),
    ]);

    for (const element of candidates) {
      if (!(element instanceof HTMLElement)) continue;
      if (state.settings.focusedInterface && state.settings.hidePullRequests) {
        if (!element.hasAttribute("data-codex-workflow-pr-hidden")) {
          element.dataset.codexWorkflowOriginalDisplay = element.style.display || "";
          element.dataset.codexWorkflowOriginalDisplayPriority = element.style.getPropertyPriority("display");
          element.dataset.codexWorkflowHadAriaHidden = String(element.hasAttribute("aria-hidden"));
          element.dataset.codexWorkflowOriginalAriaHidden = element.getAttribute("aria-hidden") || "";
          element.dataset.codexWorkflowHadTabindex = String(element.hasAttribute("tabindex"));
          element.dataset.codexWorkflowOriginalTabindex = element.getAttribute("tabindex") || "";
          element.dataset.codexWorkflowPrHidden = "true";
        }
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && element.contains(focused)) focused.blur();
        element.style.setProperty("display", "none", "important");
        element.setAttribute("aria-hidden", "true");
        element.setAttribute("tabindex", "-1");
      } else if (element.hasAttribute("data-codex-workflow-pr-hidden")) {
        const originalDisplay = element.dataset.codexWorkflowOriginalDisplay || "";
        if (originalDisplay) {
          element.style.setProperty(
            "display",
            originalDisplay,
            element.dataset.codexWorkflowOriginalDisplayPriority || "",
          );
        } else {
          element.style.removeProperty("display");
        }
        if (element.dataset.codexWorkflowHadAriaHidden === "true") {
          element.setAttribute("aria-hidden", element.dataset.codexWorkflowOriginalAriaHidden || "");
        } else {
          element.removeAttribute("aria-hidden");
        }
        if (element.dataset.codexWorkflowHadTabindex === "true") {
          element.setAttribute("tabindex", element.dataset.codexWorkflowOriginalTabindex || "");
        } else {
          element.removeAttribute("tabindex");
        }
        delete element.dataset.codexWorkflowOriginalDisplay;
        delete element.dataset.codexWorkflowOriginalDisplayPriority;
        delete element.dataset.codexWorkflowHadAriaHidden;
        delete element.dataset.codexWorkflowOriginalAriaHidden;
        delete element.dataset.codexWorkflowHadTabindex;
        delete element.dataset.codexWorkflowOriginalTabindex;
        delete element.dataset.codexWorkflowPrHidden;
      }
    }

    const hiddenCount = root.querySelectorAll('[data-codex-workflow-pr-hidden="true"]').length;
    if (hiddenCount !== state.hiddenPullRequestCount) {
      state.hiddenPullRequestCount = hiddenCount;
      log("info", `Pull requests hidden rows: ${hiddenCount}`);
    }
  }

  function findPullRequestRows(root) {
    return Array.from(root.querySelectorAll(".sidebar-item"))
      .filter((element) => {
        const link = element.matches("a[href]") ? element : element.querySelector("a[href]");
        const href = link?.getAttribute("href") || "";
        if (/^(?:app:\/\/[^/]+)?\/pull-requests(?:[/?#]|$)/u.test(href)) return true;
        const label = element.querySelector(".text-fade-truncate, [class*='truncate']");
        return compactText(label?.textContent || element.textContent) === "pull requests";
      })
      .filter((element) => {
        if (element.closest('[role="dialog"], [role="menu"], [cmdk-root]')) return false;
        return Boolean(
          element.closest(".app-shell-left-panel") ||
          element.closest(".vertical-scroll-fade-mask") ||
          element.closest('[class*="w-token-sidebar"]'),
        );
      });
  }

  function syncAccountMenuItems() {
    const petReady = syncAccountMenuItem({
      settingKey: "hidePetMenuItem",
      labels: ["show pet", "hide pet"],
      marker: "data-codex-workflow-pet-menu-hidden",
      datasetPrefix: "codexWorkflowPet",
      ambiguousStateKey: "loggedAmbiguousPetMenu",
      hiddenCountStateKey: "hiddenPetMenuItemCount",
      logLabel: "Pet menu",
    });
    const inviteReady = syncAccountMenuItem({
      settingKey: "hideInviteFriendMenuItem",
      labels: ["invite a friend"],
      marker: "data-codex-workflow-invite-friend-menu-hidden",
      datasetPrefix: "codexWorkflowInviteFriend",
      ambiguousStateKey: "loggedAmbiguousInviteFriendMenu",
      hiddenCountStateKey: "hiddenInviteFriendMenuItemCount",
      logLabel: "Friend invite menu",
    });
    if (petReady && inviteReady) stopAccountMenuDiscovery();
  }

  function syncAccountMenuItem({
    settingKey,
    labels,
    marker,
    datasetPrefix,
    ambiguousStateKey,
    hiddenCountStateKey,
    logLabel,
  }) {
    const matching = findAccountMenuItems(labels);
    const owned = Array.from(document.querySelectorAll(`[${marker}="true"]`));
    const shouldHide = state.settings.focusedInterface && state.settings[settingKey];

    if (shouldHide && matching.length > 1) {
      if (!state[ambiguousStateKey]) {
        state[ambiguousStateKey] = true;
        log("error", `${logLabel} target ambiguous: ${matching.length} candidates`);
      }
      return false;
    }
    if (matching.length <= 1) state[ambiguousStateKey] = false;

    const originalDisplayKey = `${datasetPrefix}OriginalDisplay`;
    const originalDisplayPriorityKey = `${datasetPrefix}OriginalDisplayPriority`;
    const hadAriaHiddenKey = `${datasetPrefix}HadAriaHidden`;
    const originalAriaHiddenKey = `${datasetPrefix}OriginalAriaHidden`;
    const hadTabindexKey = `${datasetPrefix}HadTabindex`;
    const originalTabindexKey = `${datasetPrefix}OriginalTabindex`;
    const candidates = new Set(shouldHide ? [...matching, ...owned] : owned);
    for (const element of candidates) {
      if (!(element instanceof HTMLElement)) continue;
      if (shouldHide) {
        if (!element.hasAttribute(marker)) {
          element.dataset[originalDisplayKey] = element.style.display || "";
          element.dataset[originalDisplayPriorityKey] = element.style.getPropertyPriority("display");
          element.dataset[hadAriaHiddenKey] = String(element.hasAttribute("aria-hidden"));
          element.dataset[originalAriaHiddenKey] = element.getAttribute("aria-hidden") || "";
          element.dataset[hadTabindexKey] = String(element.hasAttribute("tabindex"));
          element.dataset[originalTabindexKey] = element.getAttribute("tabindex") || "";
          element.setAttribute(marker, "true");
        }
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && element.contains(focused)) focused.blur();
        element.style.setProperty("display", "none", "important");
        element.setAttribute("aria-hidden", "true");
        element.setAttribute("tabindex", "-1");
      } else if (element.hasAttribute(marker)) {
        const originalDisplay = element.dataset[originalDisplayKey] || "";
        if (originalDisplay) {
          element.style.setProperty(
            "display",
            originalDisplay,
            element.dataset[originalDisplayPriorityKey] || "",
          );
        } else {
          element.style.removeProperty("display");
        }
        if (element.dataset[hadAriaHiddenKey] === "true") {
          element.setAttribute("aria-hidden", element.dataset[originalAriaHiddenKey] || "");
        } else {
          element.removeAttribute("aria-hidden");
        }
        if (element.dataset[hadTabindexKey] === "true") {
          element.setAttribute("tabindex", element.dataset[originalTabindexKey] || "");
        } else {
          element.removeAttribute("tabindex");
        }
        delete element.dataset[originalDisplayKey];
        delete element.dataset[originalDisplayPriorityKey];
        delete element.dataset[hadAriaHiddenKey];
        delete element.dataset[originalAriaHiddenKey];
        delete element.dataset[hadTabindexKey];
        delete element.dataset[originalTabindexKey];
        element.removeAttribute(marker);
      }
    }

    const hiddenCount = document.querySelectorAll(`[${marker}="true"]`).length;
    if (hiddenCount !== state[hiddenCountStateKey]) {
      state[hiddenCountStateKey] = hiddenCount;
      log("info", `${logLabel} hidden rows: ${hiddenCount}`);
    }
    return !shouldHide || matching.length === 1;
  }

  function findAccountMenuItems(expectedLabels) {
    const matches = [];
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!(menu instanceof HTMLElement) || menu.closest("[cmdk-root]")) continue;
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      if (!items.some((item) => menuItemHasLabel(item, "settings"))) continue;
      for (const item of items) {
        if (expectedLabels.some((label) => menuItemHasLabel(item, label))) matches.push(item);
      }
    }
    return matches;
  }

  function menuItemHasLabel(element, expected) {
    if (compactText(element.getAttribute("aria-label")) === expected) return true;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (compactText(walker.currentNode.nodeValue) === expected) return true;
    }
    return false;
  }

  function syncSettingsPage() {
    const shell = state.settingsShell;
    if (!shell?.isConnected) {
      if (shell) unbindSettingsShell();
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
    return Array.from(candidates).find(isSettingsNav) || null;
  }

  function isSettingsNav(nav) {
    if (!(nav instanceof HTMLElement) || !nav.isConnected) return false;
    if (nav.closest('[role="dialog"], [role="menu"], [cmdk-root], .vertical-scroll-fade-mask')) return false;
    const style = getComputedStyle(nav);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = nav.getBoundingClientRect();
    if (rect.width < 100 || rect.width > 380 || rect.height < 180 || rect.left > innerWidth / 2) return false;
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
    const source = nativeItems.find((item) => item.getAttribute("aria-current") !== "page") || appearance || nativeItems[0];
    if (!(source instanceof HTMLElement)) return null;

    const item = source.cloneNode(true);
    if (!(item instanceof HTMLElement)) return null;
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
      source.parentElement?.appendChild(item);
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
    const item = target?.closest("[data-settings-panel-slug], [data-codex-workflow='nav-item']");
    if (!item || item === state.customNav) return;
    if (state.activeWorkflow) restoreNativeSettingsView();
  }

  function activateWorkflowPanel() {
    const nav = state.settingsNav || findSettingsNav(state.settingsShell || document);
    if (!nav) return;
    const content = findContentArea(nav);
    if (!content) return;

    state.contentArea = content;
    for (const child of Array.from(content.children)) {
      if (!(child instanceof HTMLElement) || child === state.panel) continue;
      if (!child.hasAttribute("data-codex-workflow-hidden")) {
        child.dataset.codexWorkflowOriginalDisplay = child.style.display || "";
        child.dataset.codexWorkflowHidden = "true";
      }
      child.style.display = "none";
    }

    if (!state.panel?.isConnected || state.panel.parentElement !== content) {
      state.panel = renderWorkflowPanel();
      content.appendChild(state.panel);
    }
    state.panel.style.display = "flex";
    muteNativeActiveNav(nav);
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

  function renderWorkflowPanel() {
    state.settingControls.clear();
    state.customizationSection = null;
    const shell = div("flex h-full w-full min-h-0 flex-col electron:overflow-hidden electron:bg-surface electron:elevation-prominent windows:rounded-tl-lg");
    shell.dataset.codexWorkflowPanel = "true";

    const toolbar = div("flex items-center px-panel draggable electron:h-toolbar extension:h-toolbar-sm");
    const scroller = div("flex-1 scrollbar-stable overflow-y-auto p-panel");
    const page = div("mx-auto flex w-full max-w-3xl flex-col electron:min-w-[calc(320px*var(--codex-window-zoom))]");

    const titleWrap = div("pb-8");
    const header = document.createElement("header");
    header.className = "flex flex-col gap-4 px-[var(--detail-page-inline-inset,0px)]";
    const headerRow = div("flex min-w-0 items-start justify-between gap-4 flex-nowrap");
    const titleStack = div("flex min-w-0 flex-1 basis-64 flex-col gap-1.5");
    const title = document.createElement("h1");
    title.className = "min-w-0 break-words text-default heading-lg font-normal";
    title.textContent = "Workflow";
    const subtitle = div("text-base text-secondary text-balance");
    subtitle.textContent = "Tailor Codex to the way you work on this Mac.";
    titleStack.append(title, subtitle);
    headerRow.appendChild(titleStack);
    header.appendChild(headerRow);
    titleWrap.appendChild(header);

    const sections = div("flex flex-col gap-10");
    const section = document.createElement("section");
    section.className = "flex flex-col";
    const sectionHeader = div("flex justify-between gap-4 min-h-toolbar items-center pb-1.5");
    const sectionTitleStack = div("flex min-w-0 flex-1 flex-col gap-0.5");
    const sectionTitle = div("font-medium text-default text-base");
    sectionTitle.textContent = "Interface";
    sectionTitleStack.appendChild(sectionTitle);
    sectionHeader.appendChild(sectionTitleStack);
    const sectionContent = div("flex flex-col gap-1.5");
    sectionContent.appendChild(renderFocusedInterfaceCard());
    section.append(sectionHeader, sectionContent);
    sections.append(section, renderFocusedInterfaceOptionsSection());

    page.append(titleWrap, sections);
    scroller.appendChild(page);
    shell.append(toolbar, scroller);
    return shell;
  }

  function renderFocusedInterfaceCard() {
    const card = settingsCard();
    card.append(
      renderSettingRow({
        key: "focusedInterface",
        label: "Focused Interface",
        description: "Hide optional Codex features and destinations to keep the interface focused on your workflow.",
      }),
      renderCustomizeRow(),
    );
    return card;
  }

  function renderFocusedInterfaceOptionsSection() {
    const section = document.createElement("section");
    section.id = "codex-workflow-focused-options";
    section.dataset.codexWorkflow = "focused-options";
    section.className = "flex flex-col";
    section.hidden = !state.customizationOpen;
    state.customizationSection = section;

    const header = div("flex justify-between gap-4 min-h-toolbar items-center pb-1.5");
    const titleStack = div("flex min-w-0 flex-1 flex-col gap-0.5");
    const title = div("font-medium text-default text-base");
    title.textContent = "Hidden items";
    titleStack.appendChild(title);
    header.appendChild(titleStack);

    const card = settingsCard();
    card.append(
      renderSettingRow({
        key: "hidePullRequests",
        label: "Hide Pull requests",
        description: "Remove Pull requests from the sidebar.",
        requiresFocusedInterface: true,
      }),
      renderSettingRow({
        key: "hidePetMenuItem",
        label: "Hide pet controls",
        description: "Remove the pet control from the account menu.",
        requiresFocusedInterface: true,
      }),
      renderSettingRow({
        key: "hideInviteFriendMenuItem",
        label: "Hide friend invite",
        description: "Remove Invite a friend from the account menu.",
        requiresFocusedInterface: true,
      }),
    );
    section.append(header, card);
    return section;
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

  function renderCustomizeRow() {
    const row = div("flex items-center px-4 py-3");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Customize";
    button.setAttribute("aria-controls", "codex-workflow-focused-options");
    button.className = "no-drag cursor-interaction items-center gap-1 border whitespace-nowrap select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-40 flex rounded-md text-default bg-text/5 enabled:hover:bg-text/10 data-[state=open]:bg-text/10 border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px]";
    const apply = () => {
      button.setAttribute("aria-expanded", String(state.customizationOpen));
      button.dataset.state = state.customizationOpen ? "open" : "closed";
      if (state.customizationSection) state.customizationSection.hidden = !state.customizationOpen;
    };
    apply();
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.customizationOpen = !state.customizationOpen;
      apply();
    });
    row.appendChild(button);
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

  async function persistSetting(key, next) {
    const previousSettings = { ...state.settings };
    state.settings = { ...state.settings, [key]: next };
    syncFocusedInterfaceEffects();
    state.settingsWriteInFlight = true;
    refreshSettingControls();
    try {
      state.settings = normaliseSettings(
        await ipcRenderer.invoke("codex-workflow:settings:set", { [key]: next }),
      );
      syncFocusedInterfaceEffects();
    } catch (error) {
      state.settings = previousSettings;
      syncFocusedInterfaceEffects();
      log("error", `settings write failed: ${error?.stack || error}`);
    } finally {
      state.settingsWriteInFlight = false;
      refreshSettingControls();
    }
  }

  function refreshSettingControls() {
    for (const [key, control] of state.settingControls) {
      control.apply(state.settings[key]);
      control.applyDisabled(
        state.settingsWriteInFlight ||
        (control.requiresFocusedInterface && !state.settings.focusedInterface),
      );
    }
  }

  function syncFocusedInterfaceEffects() {
    syncPullRequests();
    syncAccountMenuItems();
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

  function restoreNativeSettingsView() {
    restoreVisualState(state.nativeSnapshot);
    state.nativeSnapshot = null;
    restoreVisualState(state.customInactiveSnapshot);

    const content = state.contentArea;
    if (content?.isConnected) {
      for (const child of Array.from(content.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child === state.panel) continue;
        if (child.hasAttribute("data-codex-workflow-hidden")) {
          child.style.display = child.dataset.codexWorkflowOriginalDisplay || "";
          delete child.dataset.codexWorkflowOriginalDisplay;
          delete child.dataset.codexWorkflowHidden;
        }
      }
    }
    state.panel?.remove();
    state.panel = null;
    state.settingControls.clear();
    state.customizationSection = null;
    state.contentArea = null;
    state.activeWorkflow = false;
    state.workflowEntryLocation = null;
    state.workflowNativeSlug = null;
  }

  function releaseSettingsMount() {
    restoreNativeSettingsView();
    if (state.navWithListener) {
      state.navWithListener.removeEventListener("click", onSettingsNavClick, true);
    }
    state.navWithListener = null;
    state.customNav?.remove();
    state.customNav = null;
    state.customInactiveSnapshot = null;
    state.settingsNav = null;
  }

  function syncUpdatePill() {
    const root = state.sidebarRoot;
    if (!root?.isConnected) {
      if (root) unbindSidebarRoot();
      beginDiscovery();
      return;
    }
    if (!state.updateStatus?.available) {
      state.updatePillSlot?.remove();
      state.updatePillSlot = null;
      state.updatePill = null;
      return;
    }

    const toolbar = Array.from(root.children).find((child) => {
      if (!(child instanceof HTMLElement)) return false;
      const classes = child.classList;
      return classes.contains("h-toolbar") && classes.contains("draggable");
    });
    if (!toolbar) return;

    let slot = state.updatePillSlot;
    if (!slot?.isConnected) {
      slot = div("pointer-events-auto flex h-full w-full items-center justify-end px-panel");
      slot.dataset.codexWorkflowUpdateSlot = "true";
      state.updatePillSlot = slot;
    }
    if (slot.parentElement !== toolbar) toolbar.append(slot);

    let button = state.updatePill;
    if (!button?.isConnected) {
      button = createUpdatePill();
      state.updatePill = button;
    }
    button.disabled = state.updateApplying;
    button.setAttribute("aria-label", state.updateApplying ? "Installing Workflow Update" : "Workflow Update");
    button.title = state.updateApplying ? "Installing Workflow Update" : "Workflow Update";
    syncUpdatePillMotion(button);
    if (button.parentElement !== slot) slot.append(button);
  }

  function createUpdatePill() {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.codexWorkflowUpdate = "true";

    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.dataset.codexWorkflowUpdateIcon = "true";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "size-3 shrink-0 motion-reduce:transition-none");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2.66831 12.6664V12.5004C2.66831 12.1331 2.96607 11.8353 3.33334 11.8353C3.70061 11.8353 3.99838 12.1331 3.99838 12.5004V12.6664C3.99838 13.3773 3.99929 13.8708 4.03061 14.2543C4.0613 14.6299 4.11812 14.8414 4.19858 14.9994L4.26889 15.1263C4.4452 15.4138 4.69823 15.6482 5.00034 15.8021L5.13022 15.8578C5.27399 15.9092 5.4635 15.9471 5.74545 15.9701C6.12897 16.0014 6.62231 16.0013 7.33334 16.0013H12.6664C13.3772 16.0013 13.8708 16.0014 14.2542 15.9701C14.6296 15.9394 14.8414 15.8825 14.9994 15.8021L15.1263 15.7308C15.4137 15.5545 15.6482 15.3014 15.8021 14.9994L15.8578 14.8695C15.9092 14.7258 15.947 14.5361 15.9701 14.2543C16.0014 13.8708 16.0013 13.3772 16.0013 12.6664V12.5004C16.0013 12.1332 16.2992 11.8355 16.6664 11.8353C17.0336 11.8353 17.3314 12.1331 17.3314 12.5004V12.6664C17.3314 13.3554 17.332 13.9125 17.2953 14.3627C17.2625 14.7636 17.1975 15.1248 17.0531 15.4613L16.9867 15.6039C16.7212 16.1248 16.3173 16.5606 15.8216 16.8646L15.6039 16.9867C15.2271 17.1787 14.8206 17.2579 14.3626 17.2953C13.9124 17.3321 13.3554 17.3314 12.6664 17.3314H7.33334C6.64425 17.3314 6.0873 17.3321 5.63706 17.2953C5.23651 17.2626 4.87562 17.1982 4.5394 17.0541L4.39682 16.9867C3.8757 16.7212 3.4392 16.3175 3.1351 15.8217L3.01303 15.6039C2.82106 15.2271 2.74186 14.8207 2.70444 14.3627C2.66767 13.9125 2.66831 13.3554 2.66831 12.6664ZM9.3353 3.33337C9.3353 2.9661 9.63307 2.66833 10.0003 2.66833C10.3675 2.66851 10.6654 2.96621 10.6654 3.33337V10.8939L12.8626 8.69666L12.9671 8.61169C13.2253 8.44097 13.5767 8.4693 13.804 8.69666C14.0634 8.95633 14.0635 9.37748 13.804 9.63708L10.4701 12.9701C10.3454 13.0947 10.1766 13.1653 10.0003 13.1654C9.82397 13.1654 9.65434 13.0948 9.52963 12.9701L6.19663 9.63708L6.11166 9.53259C5.9411 9.27445 5.96934 8.92394 6.19663 8.69666C6.42392 8.46937 6.77442 8.44113 7.03256 8.61169L7.13705 8.69666L9.3353 10.8949V3.33337Z");
    svg.append(path);
    icon.append(svg);

    const measurement = document.createElement("span");
    measurement.setAttribute("aria-hidden", "true");
    measurement.dataset.codexWorkflowUpdateMeasurement = "true";

    const labels = document.createElement("span");
    labels.setAttribute("aria-hidden", "true");
    labels.className = "pointer-events-none absolute inset-0 flex items-center justify-center";
    const slidingMask = document.createElement("span");
    slidingMask.dataset.codexWorkflowUpdateSlidingMask = "true";
    const slidingLabel = document.createElement("span");
    slidingLabel.dataset.codexWorkflowUpdateSlidingLabel = "true";
    const revealedLabel = document.createElement("span");
    revealedLabel.dataset.codexWorkflowUpdateLabel = "true";
    slidingMask.append(slidingLabel);
    labels.append(slidingMask, revealedLabel);
    button.append(icon, measurement, labels);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.updateApplying) return;
      state.updateApplying = true;
      syncUpdatePill();
      try {
        await ipcRenderer.invoke("codex-workflow:update:install");
      } catch (error) {
        state.updateApplying = false;
        syncUpdatePill();
        log("error", `update launch failed: ${error?.stack || error}`);
      }
    });
    return button;
  }

  function syncUpdatePillMotion(button) {
    const applying = state.updateApplying;
    const label = applying ? "Installing" : "Workflow Update";
    button.className = `pointer-events-auto no-drag relative shrink-0 cursor-interaction rounded-full bg-chart-blue text-[10px] leading-3 font-semibold text-white shadow-sm contain-layout contain-style active:bg-chart-blue/80 enabled:hover:bg-[color-mix(in_srgb,var(--color-chart-blue)_92%,black_8%)] motion-reduce:transition-none group grid h-5 max-w-36 min-w-5 items-center justify-center overflow-visible px-2.5 transition-[grid-template-columns,background-color] duration-[220ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] [will-change:grid-template-columns] focus-visible:transition-none ${applying ? "grid-cols-[1fr]" : "grid-cols-[0fr] hover:grid-cols-[1fr] focus-visible:grid-cols-[1fr]"}`;
    const icon = button.querySelector('[data-codex-workflow-update-icon="true"]');
    if (icon) {
      icon.className = `pointer-events-none absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-[80ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] [will-change:opacity,transform] group-focus-visible:transition-none motion-reduce:transform-none ${applying ? "scale-90 opacity-0" : "delay-[140ms] group-hover:scale-90 group-hover:opacity-0 group-hover:delay-0 group-focus-visible:scale-90 group-focus-visible:opacity-0 group-focus-visible:delay-0"}`;
    }
    const measurement = button.querySelector('[data-codex-workflow-update-measurement="true"]');
    if (measurement) {
      measurement.className = "invisible min-w-0 truncate tabular-nums";
      measurement.textContent = label;
    }
    const slidingMask = button.querySelector('[data-codex-workflow-update-sliding-mask="true"]');
    if (slidingMask) {
      slidingMask.className = `absolute inset-x-2.5 inset-y-0 flex items-center justify-center overflow-visible [mask-image:linear-gradient(to_left,transparent,black_8px,black)] transition-opacity duration-30 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] [will-change:opacity] group-focus-visible:transition-none motion-reduce:transition-none rtl:[mask-image:linear-gradient(to_right,transparent,black_8px,black)] ${applying ? "opacity-0 delay-[190ms]" : "opacity-100 group-hover:opacity-0 group-hover:delay-[190ms] group-focus-visible:opacity-0"}`;
    }
    const slidingLabel = button.querySelector('[data-codex-workflow-update-sliding-label="true"]');
    if (slidingLabel) {
      slidingLabel.className = `whitespace-nowrap tabular-nums transition-transform duration-[220ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] [will-change:transform] group-focus-visible:transition-none motion-reduce:transition-none ${applying ? "translate-x-0" : "translate-x-[calc(100%+12px)] group-hover:translate-x-0 group-focus-visible:translate-x-0 rtl:-translate-x-[calc(100%+12px)] rtl:group-hover:translate-x-0 rtl:group-focus-visible:translate-x-0"}`;
      slidingLabel.textContent = label;
    }
    const revealedLabel = button.querySelector('[data-codex-workflow-update-label="true"]');
    if (revealedLabel) {
      revealedLabel.className = `absolute inset-0 flex items-center justify-center whitespace-nowrap tabular-nums transition-opacity duration-30 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] [will-change:opacity] group-focus-visible:transition-none motion-reduce:transition-none ${applying ? "opacity-100 delay-[190ms]" : "opacity-0 group-hover:opacity-100 group-hover:delay-[190ms] group-focus-visible:opacity-100"}`;
      revealedLabel.textContent = label;
    }
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
