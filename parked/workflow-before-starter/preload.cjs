// Archived renderer: intentionally not loaded by the starter screen.
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
    replaceHelpWithSettings: true,
    hideComposerMicrophone: false,
    hiddenSettingsPages: [],
  };
  const discoveryDelays = [16, 50, 150, 450, 1000, 2500, 5000, 10000];
  const composerRootSelector = '[role="presentation"][data-composer-layout]';
  const discoveryRootSelector = `.app-shell-left-panel, nav[aria-label='Settings'], [data-settings-panel-slug='general-settings'], ${composerRootSelector}`;
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
    composerObserver: null,
    composerMountObservers: [],
    composerRoot: null,
    accountMenuDiscoveryObserver: null,
    accountMenuDiscoveryTimer: null,
    scheduled: false,
    dirty: { composer: false, discovery: false, sidebar: false, settings: false, toolbar: false },
    updateStatus: { available: false, installedVersion: null, availableVersion: null },
    updateApplying: false,
    updatePill: null,
    updatePillSlot: null,
    updatePillDiscoveryObserver: null,
    updatePillHost: null,
    updatePillHostObserver: null,
    updatePillHostMountObservers: [],
    updatePillResizeObserver: null,
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
    loggedAmbiguousSettingsMenu: false,
    loggedAmbiguousComposerMicrophone: false,
    sidebarHelpButton: null,
    sidebarHelpSnapshot: null,
    suppressSidebarSettingsClick: false,
    helpOpenRequested: false,
    helpAnchorRect: null,
    bypassSidebarHelp: false,
    accountSettingsSnapshots: new WeakMap(),
    accountSettingsOriginals: new WeakMap(),
    helpPopupSnapshots: new WeakMap(),
    customizationOpen: false,
    customizationSection: null,
    settingsWriteInFlight: false,
    settingControls: new Map(),
    sidebarEditing: false,
    hiddenPagesExpanded: false,
    sidebarRows: new Map(),
    sidebarSections: new Map(),
    hiddenPagesGroup: null,
    sidebarEditButton: null,
    sidebarRevertButton: null,
    sidebarVisibilityStyle: null,
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
    syncSettingsSidebarStyles();
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
      replaceHelpWithSettings: typeof value?.replaceHelpWithSettings === "boolean"
        ? value.replaceHelpWithSettings
        : defaults.replaceHelpWithSettings,
      hideComposerMicrophone: typeof value?.hideComposerMicrophone === "boolean"
        ? value.hideComposerMicrophone
        : defaults.hideComposerMicrophone,
      hiddenSettingsPages: Array.isArray(value?.hiddenSettingsPages)
        ? [...new Set(value.hiddenSettingsPages.slice(0, 100).filter((slug) =>
          typeof slug === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(slug) && slug !== "workflow"))]
        : [],
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
        scheduleWork("composer", "sidebar", "settings", "toolbar");
        return result;
      };
    }
    const onNavigation = () => {
      if (state.activeWorkflow) restoreNativeSettingsView();
      beginDiscovery();
      scheduleWork("composer", "sidebar", "settings", "toolbar");
    };
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);
  }

  function installDiscoveryHooks() {
    window.addEventListener("resize", () => scheduleWork("toolbar"), { passive: true });
    document.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.ctrlKey) return;
      const shortcut = event.target instanceof Element
        ? event.target.closest('[data-codex-workflow-settings-shortcut="true"]')
        : null;
      if (shortcut && !state.bypassSidebarHelp &&
        state.settings.focusedInterface && state.settings.replaceHelpWithSettings) {
        suppressNextSidebarSettingsClick();
        activateSidebarSettingsShortcut(event);
        return;
      }
      const target = accountMenuTriggerFromEvent(event);
      if (target) beginAccountMenuDiscovery();
    }, true);
    document.addEventListener("click", (event) => {
      const workflowTarget = event.target instanceof Element
        ? event.target.closest([
          '[data-codex-workflow-settings-shortcut="true"]',
          '[data-codex-workflow-help-updates="true"]',
          '[data-codex-workflow-help-back="true"]',
        ].join(", "))
        : null;
      if (workflowTarget?.hasAttribute("data-codex-workflow-settings-shortcut")) {
        if (state.suppressSidebarSettingsClick) {
          state.suppressSidebarSettingsClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        activateSidebarSettingsShortcut(event);
        return;
      }
      if (workflowTarget?.hasAttribute("data-codex-workflow-help-updates")) {
        activateHelpUpdates(workflowTarget, event);
        return;
      }
      if (workflowTarget?.hasAttribute("data-codex-workflow-help-back")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestAnimationFrame(closeNativeHelp);
        return;
      }
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
      if (["Enter", " "].includes(event.key) && event.target instanceof Element) {
        const workflowTarget = event.target.closest([
          '[data-codex-workflow-settings-shortcut="true"]',
          '[data-codex-workflow-help-updates="true"]',
          '[data-codex-workflow-help-back="true"]',
        ].join(", "));
        if (workflowTarget?.hasAttribute("data-codex-workflow-settings-shortcut")) {
          suppressNextSidebarSettingsClick();
          activateSidebarSettingsShortcut(event);
          return;
        }
        if (workflowTarget?.hasAttribute("data-codex-workflow-help-updates")) {
          activateHelpUpdates(workflowTarget, event);
          return;
        }
        if (workflowTarget?.hasAttribute("data-codex-workflow-help-back")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          requestAnimationFrame(closeNativeHelp);
          return;
        }
      }
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
    return isAccountMenuTrigger(target) ? target : null;
  }

  function isAccountMenuTrigger(target) {
    if (!(target instanceof HTMLElement) || !target.closest(".app-shell-left-panel")) return false;
    if (target === state.sidebarHelpButton || target.hasAttribute("data-codex-workflow-settings-shortcut")) return false;
    const label = compactText(target.getAttribute("aria-label") || target.textContent);
    return label === "open profile menu" || label === "account";
  }

  function findAccountMenuTrigger() {
    const root = state.sidebarRoot;
    if (!root?.isConnected) return null;
    const candidates = Array.from(root.querySelectorAll("button, [role='button']"))
      .filter(isAccountMenuTrigger);
    return candidates.length === 1 ? candidates[0] : null;
  }

  function scheduleWork(...kinds) {
    for (const kind of kinds) state.dirty[kind] = true;
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      const dirty = state.dirty;
      state.dirty = { composer: false, discovery: false, sidebar: false, settings: false, toolbar: false };
      try {
        if (dirty.discovery) discoverRoots();
        if (dirty.composer) syncComposerMicrophone();
        if (dirty.sidebar) {
          syncPullRequests();
          syncSidebarHelpShortcut();
        }
        if (dirty.settings) syncSettingsPage();
        if (dirty.toolbar) syncUpdatePill();
      } catch (error) {
        log("error", `scheduled renderer sync failed: ${error?.stack || error}`);
      }
    });
  }

  function beginAccountMenuDiscovery() {
    stopAccountMenuDiscovery();
    state.accountMenuDiscoveryObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationMayContainAccountMenu)) {
        syncAccountMenuItems();
        syncHelpPopup();
      }
    });
    state.accountMenuDiscoveryObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["role"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    state.accountMenuDiscoveryTimer = setTimeout(() => {
      stopAccountMenuDiscovery();
    }, 1500);
    syncAccountMenuItems();
    syncHelpPopup();
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
        if (mutations.some(mutationMayContainSettingsNavigation)) syncSettingsBeforePaint();
        if (mutations.some(mutationMayContainRoot)) scheduleWork("discovery");
      });
      state.discoveryObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    syncSettingsBeforePaint();
    scheduleWork("discovery");
  }

  function mutationMayContainSettingsNavigation(mutation) {
    if (state.settingsNav?.contains(mutation.target)) return true;
    const selector = 'nav[aria-label="Settings"], [data-settings-panel-slug]';
    return Array.from(mutation.addedNodes || []).some((node) => node instanceof Element &&
      (node.matches(selector) || Boolean(node.querySelector(selector))));
  }

  function syncSettingsBeforePaint() {
    if (!state.settings.hiddenSettingsPages.length) return;
    try {
      const shell = state.settingsShell?.isConnected ? state.settingsShell : findSettingsShell();
      if (!shell) return;
      bindSettingsShell(shell);
      syncSettingsPage();
    } catch (error) {
      log("error", `pre-paint settings sync failed: ${error?.stack || error}`);
    }
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

    const composerRoot = findComposerRoot();
    if (composerRoot) bindComposerRoot(composerRoot);
    else if (state.composerRoot) unbindComposerRoot();

    if (state.sidebarRoot?.isConnected && state.settingsShell?.isConnected && state.composerRoot?.isConnected) {
      stopDiscovery();
      return;
    }

    if (state.discoveryAttempt >= discoveryDelays.length) {
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
    return [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]
      .some((node) => {
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

  function findComposerRoot() {
    const roots = Array.from(document.querySelectorAll(composerRootSelector))
      .filter(isComposerRoot);
    return roots.length === 1 ? roots[0] : null;
  }

  function isComposerRoot(element) {
    return element instanceof HTMLElement &&
      element.isConnected &&
      !element.closest('[role="dialog"], [role="menu"], [cmdk-root]');
  }

  function bindComposerRoot(root) {
    if (state.composerRoot === root && root.isConnected) return;
    unbindComposerRoot();
    state.composerRoot = root;
    state.composerObserver = new MutationObserver(() => scheduleWork("composer"));
    state.composerObserver.observe(root, {
      attributes: true,
      attributeFilter: ["aria-label"],
      childList: true,
      subtree: true,
    });
    state.composerMountObservers = observeMountChain("composer", root);
    scheduleWork("composer");
  }

  function unbindComposerRoot() {
    state.composerObserver?.disconnect();
    state.composerObserver = null;
    disconnectObservers(state.composerMountObservers);
    state.composerMountObservers = [];
    restoreComposerMicrophones(state.composerRoot || document);
    state.composerRoot = null;
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
    stopUpdatePillDiscovery();
    releaseUpdatePillHost();
    restoreSidebarHelpShortcut();
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
    state.settingsObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationMayContainSettingsNavigation)) syncSettingsBeforePaint();
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
        if (kind === "composer" && root.isConnected) {
          beginDiscovery();
          scheduleWork("composer");
          return;
        }
        if (root.isConnected) return;
        if (kind === "sidebar" && state.sidebarRoot === root) unbindSidebarRoot();
        if (kind === "settings" && state.settingsShell === root) unbindSettingsShell();
        if (kind === "composer" && state.composerRoot === root) unbindComposerRoot();
        if (kind === "update-pill" && state.updatePillHost === root) {
          releaseUpdatePillHost();
          beginUpdatePillDiscovery();
          try {
            syncUpdatePill();
          } catch (error) {
            log("error", `update pill remount sync failed: ${error?.stack || error}`);
          }
          return;
        }
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

  const settingsGearPaths = [
    "M9.99944 7.24939C11.5169 7.2495 12.7473 8.47995 12.7475 9.99744C12.7475 11.5151 11.517 12.7454 9.99944 12.7455C8.48176 12.7455 7.2514 11.5151 7.2514 9.99744C7.25155 8.47988 8.48186 7.24939 9.99944 7.24939ZM9.99944 8.57947C9.2164 8.57947 8.58163 9.21442 8.58148 9.99744C8.58148 10.7806 9.2163 11.4154 9.99944 11.4154C10.7825 11.4153 11.4174 10.7805 11.4174 9.99744C11.4173 9.21449 10.7824 8.57958 9.99944 8.57947Z",
    "M10.6391 1.67517C11.2939 1.67532 11.8991 2.02577 12.226 2.59314L13.2485 4.36755H15.2963C15.9505 4.36758 16.555 4.71709 16.8823 5.28357L17.5219 6.39001C17.8489 6.95668 17.8481 7.65542 17.5209 8.22205L16.4975 9.99451L17.5239 11.7689C17.8519 12.3357 17.8521 13.0347 17.5248 13.6019L16.8862 14.7084C16.559 15.2747 15.9543 15.6243 15.3002 15.6244H13.2514L12.2299 17.3988C11.9029 17.9663 11.297 18.3168 10.642 18.3168L9.3637 18.3158C8.71064 18.3155 8.10718 17.9678 7.77972 17.4027L6.74847 15.6234L4.69964 15.6244C4.04558 15.6242 3.44087 15.2747 3.1137 14.7084L2.47503 13.6019C2.14791 13.0349 2.14836 12.3366 2.47601 11.7699L3.50237 9.99548L2.47894 8.22205C2.15175 7.65533 2.15174 6.95673 2.47894 6.39001L3.11761 5.28259C3.44458 4.71663 4.04894 4.36813 4.70257 4.36755L6.75042 4.36658L7.77581 2.59119C8.10301 2.02476 8.7076 1.67527 9.36175 1.67517H10.6391ZM9.36273 3.00623C9.1835 3.00623 9.01679 3.10199 8.92718 3.2572L7.82659 5.16345C7.63652 5.49253 7.28473 5.69529 6.90472 5.69568L4.70355 5.69763C4.52451 5.69782 4.3585 5.79355 4.26898 5.94861L3.6303 7.05505C3.54091 7.2102 3.54077 7.40192 3.6303 7.55701L4.73089 9.46326C4.92108 9.7929 4.92135 10.1992 4.73089 10.5287L3.62737 12.4359C3.5378 12.591 3.53792 12.7817 3.62737 12.9369L4.26605 14.0433C4.35567 14.1982 4.52067 14.2932 4.69964 14.2933L6.90276 14.2943C7.28242 14.2946 7.63335 14.497 7.82366 14.8256L8.93011 16.7357C9.01984 16.8905 9.18578 16.9857 9.36468 16.9857H10.642C10.8213 16.9857 10.987 16.89 11.0766 16.7347L12.1752 14.8275C12.3653 14.4975 12.7182 14.2943 13.0991 14.2943H15.3002C15.4794 14.2942 15.6452 14.1985 15.7348 14.0433L16.3725 12.9379C16.4621 12.7826 16.4621 12.5911 16.3725 12.4359L15.27 10.5287C15.1032 10.2404 15.0808 9.89331 15.2055 9.59021L15.269 9.46326L16.3696 7.55701C16.4591 7.40189 16.459 7.21022 16.3696 7.05505L15.7309 5.94861C15.6412 5.79363 15.4754 5.69863 15.2963 5.69861L13.0951 5.69763L12.9535 5.68884C12.6751 5.65158 12.4217 5.50519 12.2504 5.28259L12.1723 5.16443L11.0737 3.2572C10.9841 3.10175 10.8175 3.00525 10.6381 3.00525L9.36273 3.00623Z",
  ];
  const helpQuestionPaths = [
    "M16.585 10C16.585 6.3632 13.6368 3.41504 10 3.41504C6.3632 3.41504 3.41504 6.3632 3.41504 10C3.41504 13.6368 6.3632 16.585 10 16.585C13.6368 16.585 16.585 13.6368 16.585 10ZM17.915 10C17.915 14.3713 14.3713 17.915 10 17.915C5.62867 17.915 2.08496 14.3713 2.08496 10C2.08496 5.62867 5.62867 2.08496 10 2.08496C14.3713 2.08496 17.915 5.62867 17.915 10Z",
    "M9.81735 11.5962C9.3582 11.5962 9.08812 11.2829 9.08812 10.84V10.7643C9.08812 10.1269 9.41762 9.7056 10.055 9.33288C10.7519 8.91695 10.9625 8.64686 10.9625 8.1499C10.9625 7.62053 10.552 7.25321 9.9578 7.25321C9.42843 7.25321 9.07191 7.51249 8.89906 7.99325C8.76401 8.33896 8.52093 8.49021 8.19142 8.49021C7.76469 8.49021 7.5 8.22552 7.5 7.81499C7.5 7.58271 7.55402 7.37745 7.66205 7.17218C8.00776 6.45915 8.87205 6 10.0334 6C11.5675 6 12.5993 6.84267 12.5993 8.10128C12.5993 8.91695 12.2049 9.47333 11.4433 9.92167C10.7248 10.3376 10.5628 10.5699 10.4926 11.0236C10.4115 11.3856 10.2009 11.5962 9.81735 11.5962ZM9.82816 14C9.342 14 8.94767 13.6273 8.94767 13.1519C8.94767 12.6766 9.342 12.3038 9.82816 12.3038C10.3197 12.3038 10.714 12.6766 10.714 13.1519C10.714 13.6273 10.3197 14 9.82816 14Z",
  ];

  function applyFilledIcon(svg, paths) {
    if (!(svg instanceof SVGElement)) return;
    if (svg.getAttribute("viewBox") !== "0 0 20 20") svg.setAttribute("viewBox", "0 0 20 20");
    if (svg.getAttribute("fill") !== "none") svg.setAttribute("fill", "none");
    if (svg.hasAttribute("stroke")) svg.removeAttribute("stroke");
    if (svg.hasAttribute("stroke-width")) svg.removeAttribute("stroke-width");
    const children = Array.from(svg.children);
    const matches = svg.childNodes.length === paths.length &&
      children.length === paths.length &&
      paths.every((d, index) => {
        const path = children[index];
        return path instanceof SVGElement &&
          path.localName === "path" &&
          path.getAttribute("d") === d &&
          path.getAttribute("fill") === "currentColor" &&
          path.getAttribute("fill-rule") === "evenodd" &&
          path.getAttribute("clip-rule") === "evenodd";
      });
    if (matches) return;
    svg.replaceChildren(...paths.map((d) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "currentColor");
      path.setAttribute("fill-rule", "evenodd");
      path.setAttribute("clip-rule", "evenodd");
      return path;
    }));
  }

  function applyBackIcon(svg) {
    if (!(svg instanceof SVGElement)) return;
    const native = findNativeBackIcon();
    if (native) {
      const className = svg.getAttribute("class");
      for (const attribute of Array.from(svg.attributes)) {
        if (attribute.name !== "class") svg.removeAttribute(attribute.name);
      }
      for (const attribute of Array.from(native.attributes)) {
        if (!["class", "id", "aria-label"].includes(attribute.name)) {
          svg.setAttribute(attribute.name, attribute.value);
        }
      }
      if (className != null) svg.setAttribute("class", className);
      svg.innerHTML = native.innerHTML;
      return;
    }
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.replaceChildren(...["m12 19-7-7 7-7", "M19 12H5"].map((d) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      return path;
    }));
  }

  function findNativeBackIcon() {
    const root = state.sidebarRoot;
    if (!root?.isConnected) return null;
    const buttons = Array.from(root.querySelectorAll("button"));
    const button = buttons.find((candidate) => {
      const label = compactText(candidate.getAttribute("aria-label") || candidate.textContent);
      return label === "back" || label === "go back";
    });
    return button?.querySelector("svg") || null;
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

  function syncSidebarHelpShortcut() {
    const root = state.sidebarRoot;
    if (!root?.isConnected) return;
    const enabled = state.settings.focusedInterface && state.settings.replaceHelpWithSettings;
    if (!enabled) {
      restoreSidebarHelpShortcut();
      return;
    }

    const owned = root.querySelector('[data-codex-workflow-settings-shortcut="true"]');
    const native = Array.from(root.querySelectorAll('button[aria-label="Open help menu"]'));
    const button = owned || (native.length === 1 ? native[0] : null);
    if (!(button instanceof HTMLButtonElement)) return;
    if (state.sidebarHelpButton && state.sidebarHelpButton !== button) restoreSidebarHelpShortcut();
    if (!state.sidebarHelpSnapshot || state.sidebarHelpButton !== button) {
      state.sidebarHelpSnapshot = {
        innerHTML: button.innerHTML,
        ariaLabel: button.getAttribute("aria-label"),
        hadAriaLabel: button.hasAttribute("aria-label"),
        title: button.getAttribute("title"),
        hadTitle: button.hasAttribute("title"),
      };
      state.sidebarHelpButton = button;
      button.addEventListener("click", onSidebarSettingsClick, true);
    }
    button.dataset.codexWorkflowSettingsShortcut = "true";
    button.setAttribute("aria-label", "Open settings");
    button.setAttribute("title", "Settings");
    const svg = button.querySelector("svg");
    if (svg) applyFilledIcon(svg, settingsGearPaths);
  }

  function restoreSidebarHelpShortcut() {
    const button = state.sidebarHelpButton;
    const snapshot = state.sidebarHelpSnapshot;
    if (button?.isConnected && snapshot) {
      button.innerHTML = snapshot.innerHTML;
      if (snapshot.hadAriaLabel) button.setAttribute("aria-label", snapshot.ariaLabel || "");
      else button.removeAttribute("aria-label");
      if (snapshot.hadTitle) button.setAttribute("title", snapshot.title || "");
      else button.removeAttribute("title");
      button.removeAttribute("data-codex-workflow-settings-shortcut");
      button.removeEventListener("click", onSidebarSettingsClick, true);
    }
    state.sidebarHelpButton = null;
    state.sidebarHelpSnapshot = null;
  }

  function onSidebarSettingsClick(event) {
    if (state.bypassSidebarHelp) return;
    activateSidebarSettingsShortcut(event);
  }

  function suppressNextSidebarSettingsClick() {
    state.suppressSidebarSettingsClick = true;
    setTimeout(() => {
      state.suppressSidebarSettingsClick = false;
    }, 0);
  }

  function activateSidebarSettingsShortcut(event) {
    if (state.bypassSidebarHelp) return;
    if (!(state.settings.focusedInterface && state.settings.replaceHelpWithSettings)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestAnimationFrame(openNativeSettings);
  }

  function openNativeSettings() {
    ipcRenderer.invoke("codex-workflow:settings:activate", {
      target: "keyboard-shortcut",
    }).catch((error) => {
      log("error", `Settings shortcut activation failed: ${error?.message || error}`);
      beginDiscovery();
    });
  }

  function syncAccountMenuItems() {
    const settingsReady = syncAccountSettingsItem();
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
    const keepWatchingSettings = state.settings.focusedInterface &&
      state.settings.replaceHelpWithSettings;
    if (settingsReady && petReady && inviteReady && !state.helpOpenRequested && !keepWatchingSettings) {
      stopAccountMenuDiscovery();
    }
  }

  function syncAccountSettingsItem() {
    const shouldReplace = state.settings.focusedInterface && state.settings.replaceHelpWithSettings;
    const matching = findAccountSettingsItems();
    const owned = Array.from(document.querySelectorAll('[data-codex-workflow-help-updates="true"]'));

    if (matching.length > 1) {
      if (!state.loggedAmbiguousSettingsMenu) {
        state.loggedAmbiguousSettingsMenu = true;
        log("error", `Settings menu target ambiguous: ${matching.length} candidates`);
      }
      return false;
    }
    state.loggedAmbiguousSettingsMenu = false;

    if (!shouldReplace) {
      for (const item of owned) restoreAccountSettingsItem(item);
      return true;
    }
    if (matching.length !== 1) return false;
    transformAccountSettingsItem(matching[0], owned);
    return true;
  }

  function transformAccountSettingsItem(item, ownedItems) {
    if (!(item instanceof HTMLElement)) return;
    let snapshot = state.accountSettingsSnapshots.get(item);
    const menu = item.closest('[role="menu"]');
    for (const owned of ownedItems) {
      if (owned === snapshot?.clone) continue;
      const original = state.accountSettingsOriginals.get(owned);
      if (!original?.isConnected || original === item || (menu && owned.closest('[role="menu"]') === menu)) {
        restoreAccountSettingsItem(owned);
      }
    }
    if (!snapshot) {
      snapshot = {
        nativeHTML: item.innerHTML,
        display: item.style.getPropertyValue("display"),
        displayPriority: item.style.getPropertyPriority("display"),
        hadAriaHidden: item.hasAttribute("aria-hidden"),
        ariaHidden: item.getAttribute("aria-hidden"),
        hadTabindex: item.hasAttribute("tabindex"),
        tabindex: item.getAttribute("tabindex"),
        clone: null,
      };
      state.accountSettingsSnapshots.set(item, snapshot);
    }
    if (!snapshot.clone?.isConnected || snapshot.nativeHTML !== item.innerHTML) {
      snapshot.clone?.remove();
      snapshot.nativeHTML = item.innerHTML;
      snapshot.clone = item.cloneNode(true);
      for (const element of [snapshot.clone, ...snapshot.clone.querySelectorAll("*")]) {
        element.removeAttribute("id");
        element.removeAttribute("aria-controls");
        element.removeAttribute("aria-expanded");
        element.removeAttribute("data-highlighted");
        element.removeAttribute("data-state");
      }
      snapshot.clone.addEventListener("click", onHelpUpdatesClick, true);
      snapshot.clone.addEventListener("keydown", onHelpUpdatesKeyDown, true);
      state.accountSettingsOriginals.set(snapshot.clone, item);
      item.after(snapshot.clone);
    }
    item.style.setProperty("display", "none", "important");
    item.setAttribute("aria-hidden", "true");
    item.setAttribute("tabindex", "-1");
    const clone = snapshot.clone;
    clone.dataset.codexWorkflowHelpUpdates = "true";
    clone.setAttribute("aria-label", "Help & Updates");
    clone.removeAttribute("aria-hidden");
    const svg = clone.querySelector("svg");
    if (svg) applyFilledIcon(svg, helpQuestionPaths);
    const label = findExactTextNode(clone, ["settings", "help & updates"]);
    if (label && label.nodeValue !== "Help & Updates") label.nodeValue = "Help & Updates";
    const shortcut = findExactTextNode(clone, ["⌘,"]);
    if (shortcut?.parentElement) {
      shortcut.parentElement.style.setProperty("display", "none", "important");
      shortcut.parentElement.setAttribute("aria-hidden", "true");
    }
  }

  function restoreAccountSettingsItem(item) {
    if (!(item instanceof HTMLElement)) return;
    const original = state.accountSettingsOriginals.get(item);
    const snapshot = original ? state.accountSettingsSnapshots.get(original) : null;
    if (original && snapshot) {
      item.remove();
      if (snapshot.display) original.style.setProperty("display", snapshot.display, snapshot.displayPriority);
      else original.style.removeProperty("display");
      if (snapshot.hadAriaHidden) original.setAttribute("aria-hidden", snapshot.ariaHidden || "");
      else original.removeAttribute("aria-hidden");
      if (snapshot.hadTabindex) original.setAttribute("tabindex", snapshot.tabindex || "");
      else original.removeAttribute("tabindex");
      state.accountSettingsOriginals.delete(item);
      state.accountSettingsSnapshots.delete(original);
      return;
    }
    item.removeAttribute("data-codex-workflow-help-updates");
  }

  function onHelpUpdatesKeyDown(event) {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  function onHelpUpdatesClick(event) {
    activateHelpUpdates(event.currentTarget, event);
  }

  function activateHelpUpdates(item, event) {
    if (!(state.settings.focusedInterface && state.settings.replaceHelpWithSettings)) return;
    const menu = item instanceof Element ? item.closest('[role="menu"]') : null;
    const labelledBy = menu instanceof HTMLElement ? menu.getAttribute("aria-labelledby") : null;
    const labelledTrigger = labelledBy ? document.getElementById(labelledBy) : null;
    const accountTrigger = labelledTrigger instanceof HTMLElement &&
      labelledTrigger.matches("button, [role='button']") &&
      labelledTrigger.closest(".app-shell-left-panel")
      ? labelledTrigger
      : findAccountMenuTrigger();
    event.preventDefault();
    event.stopImmediatePropagation();
    const helpTrigger = findSidebarHelpShortcut();
    if (!(menu instanceof HTMLElement) || !accountTrigger || !helpTrigger) return;
    const rect = menu.getBoundingClientRect();
    state.helpAnchorRect = { left: rect.left, bottom: rect.bottom };
    state.helpOpenRequested = true;
    requestAnimationFrame(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }));
      requestAnimationFrame(() => openHelpAfterAccountMenuCloses(menu));
    });
  }

  function openHelpAfterAccountMenuCloses(menu, attempt = 0) {
    if (menu.isConnected) {
      if (attempt >= 60) {
        state.helpOpenRequested = false;
        return;
      }
      requestAnimationFrame(() => openHelpAfterAccountMenuCloses(menu, attempt + 1));
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(openHelpAfterAccountFocusSettles));
  }

  function openHelpAfterAccountFocusSettles() {
    openNativeHelp();
    beginAccountMenuDiscovery();
    requestAnimationFrame(syncRequestedHelpPopup);
  }

  function syncRequestedHelpPopup(attempt = 0) {
    syncHelpPopup();
    if (!state.helpOpenRequested) return;
    if (attempt >= 20) {
      state.helpOpenRequested = false;
      return;
    }
    requestAnimationFrame(() => syncRequestedHelpPopup(attempt + 1));
  }

  function openNativeHelp() {
    const button = findSidebarHelpShortcut();
    if (!button) return;
    state.bypassSidebarHelp = true;
    try {
      openNativeMenuTrigger(button);
    } finally {
      state.bypassSidebarHelp = false;
    }
  }

  function openNativeMenuTrigger(button) {
    button.focus({ preventScroll: true });
    button.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "ArrowDown",
      composed: true,
      key: "ArrowDown",
    }));
  }

  function findSidebarHelpShortcut() {
    const button = state.sidebarRoot?.querySelector('[data-codex-workflow-settings-shortcut="true"]');
    return button instanceof HTMLButtonElement ? button : null;
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
      if (!isAccountMenu(menu)) continue;
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      for (const item of items) {
        if (expectedLabels.some((label) => menuItemHasLabel(item, label))) matches.push(item);
      }
    }
    return matches;
  }

  function findAccountSettingsItems() {
    const matches = [];
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!isAccountMenu(menu)) continue;
      for (const item of menu.querySelectorAll('[role="menuitem"]')) {
        if (!item.hasAttribute("data-codex-workflow-help-updates") && menuItemHasLabel(item, "settings")) matches.push(item);
      }
    }
    return matches;
  }

  function isAccountMenu(menu) {
    if (!(menu instanceof HTMLElement) || menu.closest("[cmdk-root]")) return false;
    return Array.from(menu.querySelectorAll('[role="menuitem"]')).some((item) =>
      item.hasAttribute("data-codex-workflow-help-updates") || menuItemHasLabel(item, "settings"));
  }

  function menuItemHasLabel(element, expected) {
    if (compactText(element.getAttribute("aria-label")) === expected) return true;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (compactText(walker.currentNode.nodeValue) === expected) return true;
    }
    return false;
  }

  function findExactTextNode(element, labels) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (labels.includes(compactText(walker.currentNode.nodeValue))) return walker.currentNode;
    }
    return null;
  }

  function syncHelpPopup() {
    const enabled = state.settings.focusedInterface && state.settings.replaceHelpWithSettings;
    if (!enabled) {
      restoreOwnedHelpPopups();
      state.helpOpenRequested = false;
      state.helpAnchorRect = null;
      return;
    }
    const popups = findHelpPopups();
    if (popups.length !== 1) return;
    const popup = popups[0];
    if (!state.helpOpenRequested && !popup.hasAttribute("data-codex-workflow-help-popup")) return;
    decorateHelpPopup(popup);
    state.helpOpenRequested = false;
  }

  function findHelpPopups() {
    return Array.from(document.querySelectorAll('[role="menu"]')).filter((menu) => {
      if (!(menu instanceof HTMLElement) || isAccountMenu(menu) || menu.closest("[cmdk-root]")) return false;
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const hasWhatsNew = Boolean(findExactTextNode(menu, ["what's new", "what’s new"]));
      return hasWhatsNew &&
        items.some((item) => menuItemHasLabel(item, "keyboard shortcuts")) &&
        items.some((item) => menuItemHasLabel(item, "help"));
    });
  }

  function decorateHelpPopup(popup) {
    if (!state.helpPopupSnapshots.has(popup)) {
      state.helpPopupSnapshots.set(popup, {
        translate: popup.style.getPropertyValue("translate"),
        translatePriority: popup.style.getPropertyPriority("translate"),
        hadTranslate: popup.style.getPropertyValue("translate") !== "",
      });
      popup.dataset.codexWorkflowHelpPopup = "true";
    }
    if (!popup.querySelector('[data-codex-workflow-help-back="true"]')) {
      insertHelpBackItem(popup);
    }
    alignHelpPopup(popup);
    requestAnimationFrame(() => {
      if (popup.isConnected && popup.hasAttribute("data-codex-workflow-help-popup")) {
        alignHelpPopup(popup);
      }
    });
  }

  function alignHelpPopup(popup) {
    const anchor = state.helpAnchorRect;
    if (!anchor) return;
    const rect = popup.getBoundingClientRect();
    const currentX = Number(popup.dataset.codexWorkflowHelpTranslateX || 0);
    const currentY = Number(popup.dataset.codexWorkflowHelpTranslateY || 0);
    const nextX = currentX + anchor.left - rect.left;
    const nextY = currentY + anchor.bottom - rect.bottom;
    if (![nextX, nextY].every(Number.isFinite)) return;
    const translate = `${nextX}px ${nextY}px`;
    const translateX = String(nextX);
    const translateY = String(nextY);
    if (popup.style.getPropertyValue("translate") !== translate) {
      popup.style.setProperty("translate", translate);
    }
    if (popup.dataset.codexWorkflowHelpTranslateX !== translateX) {
      popup.dataset.codexWorkflowHelpTranslateX = translateX;
    }
    if (popup.dataset.codexWorkflowHelpTranslateY !== translateY) {
      popup.dataset.codexWorkflowHelpTranslateY = translateY;
    }
  }

  function insertHelpBackItem(popup) {
    const template = Array.from(popup.querySelectorAll('[role="menuitem"]'))
      .find((item) => menuItemHasLabel(item, "keyboard shortcuts"));
    if (!(template instanceof HTMLElement)) return;
    const back = template.cloneNode(true);
    for (const element of [back, ...back.querySelectorAll("*")]) {
      element.removeAttribute("id");
      element.removeAttribute("aria-controls");
      element.removeAttribute("aria-expanded");
      element.removeAttribute("data-highlighted");
      element.removeAttribute("data-state");
    }
    back.dataset.codexWorkflowHelpBack = "true";
    back.setAttribute("aria-label", "Back");
    if (back instanceof HTMLButtonElement) back.type = "button";
    const label = findExactTextNode(back, ["keyboard shortcuts"]);
    if (label) label.nodeValue = "Back";
    const svg = back.querySelector("svg");
    if (svg) applyBackIcon(svg);
    back.addEventListener("click", onHelpBackClick, true);
    back.addEventListener("keydown", onHelpBackKeyDown, true);

    const separatorTemplate = popup.querySelector('[role="separator"]');
    const separator = separatorTemplate?.cloneNode(true) || null;
    if (separator instanceof HTMLElement) {
      separator.removeAttribute("id");
      separator.dataset.codexWorkflowHelpBackSeparator = "true";
      popup.prepend(separator);
    }
    popup.prepend(back);
  }

  function onHelpBackKeyDown(event) {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  function onHelpBackClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestAnimationFrame(closeNativeHelp);
  }

  function closeNativeHelp() {
    state.helpOpenRequested = false;
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }));
  }

  function restoreOwnedHelpPopups() {
    for (const popup of document.querySelectorAll('[data-codex-workflow-help-popup="true"]')) {
      const snapshot = state.helpPopupSnapshots.get(popup);
      if (snapshot?.hadTranslate) {
        popup.style.setProperty("translate", snapshot.translate, snapshot.translatePriority);
      } else {
        popup.style.removeProperty("translate");
      }
      popup.querySelector('[data-codex-workflow-help-back="true"]')?.remove();
      popup.querySelector('[data-codex-workflow-help-back-separator="true"]')?.remove();
      popup.removeAttribute("data-codex-workflow-help-translate-x");
      popup.removeAttribute("data-codex-workflow-help-translate-y");
      popup.removeAttribute("data-codex-workflow-help-popup");
      state.helpPopupSnapshots.delete(popup);
    }
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
      nav.addEventListener("keydown", onSettingsSidebarKeyDown, true);
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
    syncSettingsSidebar();
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
    const owned = state.sidebarRows.get(source);
    if (owned) restoreSidebarDisplay(item, owned);
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
      syncSettingsSidebar();
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
    const focusedRow = renderSettingRow({
      key: "focusedInterface",
      label: "Focused Interface",
      description: "Hide optional Codex features and destinations to keep the interface focused on your workflow.",
    });
    focusedRow.lastElementChild.prepend(renderCustomizeButton());
    card.append(
      focusedRow,
      renderSettingRow({
        key: "hideComposerMicrophone",
        label: "Hide microphone button",
        description: "Remove the Dictate button from the composer.",
      }),
      renderSidebarCustomizeRow(),
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
    title.textContent = "Focused Interface options";
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
      renderSettingRow({
        key: "replaceHelpWithSettings",
        label: "Replace Help with Settings",
        description: "Use a Settings shortcut in the sidebar and move Help & Updates to the account menu.",
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

  function renderCustomizeButton() {
    const button = renderActionButton("Customise");
    button.setAttribute("aria-label", "Customise Focused Interface");
    button.setAttribute("aria-controls", "codex-workflow-focused-options");
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
    return button;
  }

  function renderActionButton(label, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    const variant = danger ? "bg-chart-red/10 enabled:hover:bg-chart-red/20 text-chart-red" : "text-default bg-text/5 enabled:hover:bg-text/10 data-[state=open]:bg-text/10";
    button.className = `no-drag cursor-interaction items-center gap-1 border whitespace-nowrap select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-40 flex rounded-md ${variant} border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px]`;
    return button;
  }

  function renderSidebarCustomizeRow() {
    const row = div("flex items-center justify-between px-4 gap-6 py-3");
    const copy = div("flex min-w-0 flex-1 flex-col gap-0.5");
    const label = div("min-w-0 text-sm text-default font-medium");
    label.id = "codex-workflow-sidebar-label";
    label.textContent = "Customise settings sidebar";
    const description = div("min-w-0 text-xs leading-4 text-balance text-secondary");
    description.id = "codex-workflow-sidebar-description";
    description.textContent = "Move pages into Hidden without turning off their features. They remain searchable.";
    copy.append(label, description);
    const action = renderActionButton("Customise");
    action.setAttribute("aria-describedby", description.id);
    action.dataset.codexWorkflow = "sidebar-edit";
    action.addEventListener("click", () => {
      state.sidebarEditing = !state.sidebarEditing;
      state.hiddenPagesExpanded = state.sidebarEditing;
      syncSettingsSidebar();
    });
    state.sidebarEditButton = action;
    const revert = renderActionButton("Revert", true);
    revert.setAttribute("aria-label", "Revert settings sidebar to default");
    revert.setAttribute("aria-describedby", description.id);
    revert.dataset.codexWorkflow = "sidebar-revert";
    revert.addEventListener("click", () => {
      if (!state.settingsWriteInFlight && state.settings.hiddenSettingsPages.length) {
        persistSetting("hiddenSettingsPages", []);
      }
    });
    state.sidebarRevertButton = revert;
    const controls = div("flex max-w-full shrink-0 items-center gap-2");
    controls.append(revert, action);
    row.append(copy, controls);
    return row;
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

  function restoreSidebarDisplay(element, record) {
    if (record.display) element.style.setProperty("display", record.display, record.priority);
    else element.style.removeProperty("display");
    if (element.style.cssText === record.originalCssText && record.hadStyle) element.setAttribute("style", record.styleText);
    if (!record.hadStyle && !element.getAttribute("style")) element.removeAttribute("style");
    if (record.ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", record.ariaHidden);
  }

  function snapshotSidebarDisplay(source) {
    return { display: source.style.display, priority: source.style.getPropertyPriority("display"),
      hadStyle: source.hasAttribute("style"), styleText: source.getAttribute("style"),
      originalCssText: source.style.cssText, ariaHidden: source.getAttribute("aria-hidden") };
  }

  function releaseSidebarRow(source, record) {
    refreshSidebarSnapshot(source, record);
    restoreSidebarDisplay(source, record);
    if (record.wrapper.contains(document.activeElement) && source.isConnected) {
      source.focus({ preventScroll: true });
    }
    record.wrapper.remove();
    source.removeAttribute("data-codex-workflow-sidebar-hidden");
    state.sidebarRows.delete(source);
  }

  function refreshSidebarSnapshot(source, record) {
    if (source.style.display !== "none" || source.style.getPropertyPriority("display") !== "important") {
      record.display = source.style.display;
      record.priority = source.style.getPropertyPriority("display");
      record.hadStyle = source.hasAttribute("style");
      record.styleText = source.getAttribute("style");
      record.originalCssText = source.style.cssText;
    }
    if (source.getAttribute("aria-hidden") !== "true") record.ariaHidden = source.getAttribute("aria-hidden");
  }

  function releaseSettingsSidebar() {
    for (const [source, record] of state.sidebarRows) releaseSidebarRow(source, record);
    for (const [section, record] of state.sidebarSections) {
      refreshSidebarSnapshot(section, record);
      restoreSidebarDisplay(section, record);
      section.removeAttribute("data-codex-workflow-sidebar-empty");
    }
    state.sidebarSections.clear();
    state.hiddenPagesGroup?.remove();
    state.hiddenPagesGroup = null;
  }

  function syncSettingsSidebarSections(owner, hidden) {
    const empty = new Set();
    for (const section of owner.children) {
      const [header, rows] = section.children;
      if (section.children.length !== 2 || !header.classList.contains("group/nav-section-title") ||
        header.querySelector('button, a, [role="button"]') || !rows.children.length) continue;
      if (Array.from(rows.children).every((row) => state.sidebarRows.has(row) && hidden.has(row.dataset.settingsPanelSlug))) {
        empty.add(section);
      }
    }
    for (const [section, record] of state.sidebarSections) {
      refreshSidebarSnapshot(section, record);
      if (!empty.has(section)) {
        restoreSidebarDisplay(section, record);
        section.removeAttribute("data-codex-workflow-sidebar-empty");
        state.sidebarSections.delete(section);
      }
    }
    for (const section of empty) {
      if (!state.sidebarSections.has(section)) state.sidebarSections.set(section, snapshotSidebarDisplay(section));
      section.dataset.codexWorkflowSidebarEmpty = "true";
      section.style.setProperty("display", "none", "important");
      section.setAttribute("aria-hidden", "true");
    }
  }

  function sidebarGlyph(path) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "icon-xs");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(svg.namespaceURI, "path");
    shape.setAttribute("d", path);
    svg.append(shape);
    return svg;
  }

  function sidebarIconButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "no-drag flex size-6 shrink-0 items-center justify-center rounded-full cursor-interaction hover:bg-primary-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40";
    button.setAttribute("aria-label", label);
    return button;
  }

  function createHiddenPagesGroup() {
    const group = div("flex flex-col gap-1");
    group.dataset.codexWorkflow = "hidden-pages";
    const header = div("group/nav-section-title flex items-center justify-between gap-2 browser:h-9 browser:ps-2.5 pe-0.5 ps-2");
    const title = div("min-w-0 flex-1 text-base font-medium text-tertiary opacity-75 browser:leading-4.5");
    title.textContent = "Hidden";
    const disclosure = sidebarIconButton("Show hidden settings pages");
    disclosure.setAttribute("aria-controls", "codex-workflow-hidden-pages");
    const glyph = sidebarGlyph("m6 9 6 6 6-6");
    glyph.classList.add("text-tertiary", "opacity-75");
    disclosure.append(glyph);
    disclosure.addEventListener("click", () => {
      state.hiddenPagesExpanded = !state.hiddenPagesExpanded;
      syncSettingsSidebar();
    });
    header.append(title, disclosure);
    const rows = div("flex flex-col gap-px browser:gap-0");
    rows.id = "codex-workflow-hidden-pages";
    group.append(header, rows);
    return group;
  }

  function syncSettingsSidebarStyles() {
    const hidden = state.settings.hiddenSettingsPages;
    if (!hidden.length) {
      state.sidebarVisibilityStyle?.remove();
      state.sidebarVisibilityStyle = null;
      return;
    }
    const nav = ':is(.app-shell-left-panel, [data-testid="app-shell-floating-left-panel"]) nav.sidebar-navigation[aria-label="Settings"]:not([data-codex-workflow-sidebar-measuring]):not([role="dialog"] *, [role="menu"] *, [cmdk-root] *, .vertical-scroll-fade-mask *)';
    const rows = `:is(${hidden.map((slug) => `button[data-settings-panel-slug="${slug}"]:not(:disabled)`).join(", ")})`;
    const header = '[class~="group/nav-section-title"]';
    const section = `${nav} .overflow-y-auto > div:has(> ${header} + div > ${rows}):not(:has(> :nth-child(3), > ${header} :is(button, a, [role="button"]), > ${header} + div > :not(${rows})))`;
    const css = `${nav} ${rows}, ${section} { display: none !important; }`;
    if (!state.sidebarVisibilityStyle?.isConnected) {
      const parent = document.head || document.documentElement;
      if (!parent) return;
      state.sidebarVisibilityStyle = document.createElement("style");
      state.sidebarVisibilityStyle.dataset.codexWorkflow = "sidebar-visibility";
      parent.append(state.sidebarVisibilityStyle);
    }
    if (state.sidebarVisibilityStyle.textContent !== css) state.sidebarVisibilityStyle.textContent = css;
  }

  function syncSettingsSidebar() {
    syncSettingsSidebarStyles();
    if (state.sidebarEditButton?.isConnected) {
      const label = state.sidebarEditing ? "Done" : "Customise";
      if (state.sidebarEditButton.textContent !== label) state.sidebarEditButton.textContent = label;
      state.sidebarEditButton.setAttribute("aria-label", `${label} settings sidebar`);
      state.sidebarEditButton.setAttribute("aria-pressed", String(state.sidebarEditing));
      state.sidebarEditButton.disabled = state.settingsWriteInFlight;
    }
    if (state.sidebarRevertButton?.isConnected) {
      state.sidebarRevertButton.disabled = state.settingsWriteInFlight || !state.settings.hiddenSettingsPages.length;
    }
    const nav = state.settingsNav;
    if (!nav?.isConnected) return;
    const owners = nav.querySelectorAll(".overflow-y-auto");
    if (owners.length !== 1) { releaseSettingsSidebar(); return; }
    const owner = owners[0];
    let sources;
    nav.setAttribute("data-codex-workflow-sidebar-measuring", "");
    try {
      sources = Array.from(owner.querySelectorAll("button[data-settings-panel-slug]"))
        .filter((source) => source !== state.customNav && !source.disabled &&
          (state.sidebarRows.has(source) || getComputedStyle(source).display !== "none" && source.getAttribute("aria-hidden") !== "true"));
    } finally {
      nav.removeAttribute("data-codex-workflow-sidebar-measuring");
    }
    const slugs = sources.map((source) => source.dataset.settingsPanelSlug);
    if (new Set(slugs).size !== slugs.length) { releaseSettingsSidebar(); return; }
    const hidden = new Set(state.settings.hiddenSettingsPages);
    hidden.delete("workflow");
    for (const [source, record] of state.sidebarRows) {
      if (!sources.includes(source) || (!state.sidebarEditing && !hidden.has(source.dataset.settingsPanelSlug))) {
        releaseSidebarRow(source, record);
      }
    }
    const hiddenSources = sources.filter((source) => hidden.has(source.dataset.settingsPanelSlug));
    if (hiddenSources.length) {
      if (!state.hiddenPagesGroup?.isConnected) state.hiddenPagesGroup = createHiddenPagesGroup();
      let lastSection = sources.at(-1);
      while (lastSection.parentElement !== owner) lastSection = lastSection.parentElement;
      if (lastSection.nextElementSibling !== state.hiddenPagesGroup) lastSection.after(state.hiddenPagesGroup);
      const disclosure = state.hiddenPagesGroup.querySelector("button");
      disclosure.setAttribute("aria-expanded", String(state.hiddenPagesExpanded));
      disclosure.setAttribute("aria-label", `${state.hiddenPagesExpanded ? "Hide" : "Show"} hidden settings pages`);
      disclosure.querySelector("path").setAttribute("d", state.hiddenPagesExpanded ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6");
      const rows = state.hiddenPagesGroup.lastElementChild;
      if (!state.hiddenPagesExpanded && rows.contains(document.activeElement)) disclosure.focus({ preventScroll: true });
      rows.hidden = !state.hiddenPagesExpanded;
      rows.style.display = state.hiddenPagesExpanded ? "" : "none";
    }
    for (const source of sources) {
      const slug = source.dataset.settingsPanelSlug;
      if (slug === "workflow") continue;
      const isHidden = hidden.has(slug);
      if (!isHidden && !state.sidebarEditing) continue;
      let record = state.sidebarRows.get(source);
      if (!record) {
        const wrapper = div("relative");
        wrapper.dataset.codexWorkflow = "sidebar-row";
        const control = sidebarIconButton("");
        control.style.position = "absolute";
        control.style.insetInlineEnd = "var(--padding-row-x)";
        control.style.top = "0";
        control.style.bottom = "0";
        control.style.marginBlock = "auto";
        control.addEventListener("click", async () => {
          if (state.settingsWriteInFlight) return;
          const next = new Set(state.settings.hiddenSettingsPages);
          if (next.has(slug)) next.delete(slug);
          else next.add(slug);
          state.hiddenPagesExpanded = true;
          const scrollTop = owner.scrollTop;
          const write = persistSetting("hiddenSettingsPages", [...next]);
          owner.scrollTop = scrollTop;
          await write;
          const current = state.sidebarRows.get(source);
          (current?.control.isConnected && state.sidebarEditing ? current.control : source).focus({ preventScroll: true });
        });
        record = { wrapper, control, ...snapshotSidebarDisplay(source), signature: null, proxy: null, editing: null };
        state.sidebarRows.set(source, record);
      }
      refreshSidebarSnapshot(source, record);
      const signature = source.innerHTML + source.className + source.getAttribute("aria-current") + source.getAttribute("aria-label");
      if (record.signature !== signature) {
        const proxy = source.cloneNode(true);
        scrubSidebarClone(proxy);
        restoreSidebarDisplay(proxy, record);
        proxy.dataset.codexWorkflowPage = slug;
        proxy.addEventListener("click", () => source.click());
        if (record.proxy === document.activeElement) { record.proxy.replaceWith(proxy); proxy.focus({ preventScroll: true }); }
        else if (record.proxy) record.proxy.replaceWith(proxy);
        else record.wrapper.append(proxy, record.control);
        record.proxy = proxy;
        record.signature = signature;
        record.editing = null;
      }
      if (record.editing !== state.sidebarEditing) {
        record.proxy.style.setProperty("padding-inline-end",
          state.sidebarEditing ? "calc(var(--height-token-row) + var(--padding-row-x))" : source.style.getPropertyValue("padding-inline-end"),
          state.sidebarEditing ? "" : source.style.getPropertyPriority("padding-inline-end"));
        record.control.hidden = !state.sidebarEditing;
        record.control.style.display = state.sidebarEditing ? "" : "none";
        record.editing = state.sidebarEditing;
      }
      const label = `${isHidden ? "Restore" : "Hide"} ${source.getAttribute("aria-label") || source.textContent.replace(/\s+/gu, " ").trim()}`;
      if (record.control.getAttribute("aria-label") !== label) {
        record.control.setAttribute("aria-label", label);
        const glyph = sidebarGlyph(isHidden ? "M5 12h14M12 5v14" : "M5 12h14");
        const circle = div(isHidden ? "flex size-4 items-center justify-center rounded-full text-default bg-text/5" : "flex size-4 items-center justify-center rounded-full text-white bg-danger-solid");
        circle.append(glyph);
        record.control.replaceChildren(circle);
      }
      record.control.disabled = state.settingsWriteInFlight;
      if (isHidden) {
        const rows = state.hiddenPagesGroup.lastElementChild;
        if (record.wrapper.parentElement !== rows) rows.append(record.wrapper);
      } else if (source.nextElementSibling !== record.wrapper) source.after(record.wrapper);
      if (source.contains(document.activeElement)) {
        (isHidden && !state.hiddenPagesExpanded ? state.hiddenPagesGroup.querySelector("button") : record.proxy).focus({ preventScroll: true });
      }
      source.setAttribute("data-codex-workflow-sidebar-hidden", "true");
      source.style.setProperty("display", "none", "important");
      source.setAttribute("aria-hidden", "true");
    }
    if (!hiddenSources.length) {
      state.hiddenPagesGroup?.remove();
      state.hiddenPagesGroup = null;
    } else {
      const rows = state.hiddenPagesGroup.lastElementChild;
      hiddenSources.forEach((source, index) => {
        const wrapper = state.sidebarRows.get(source)?.wrapper;
        if (wrapper && rows.children[index] !== wrapper) rows.insertBefore(wrapper, rows.children[index] || null);
      });
    }
    syncSettingsSidebarSections(owner, hidden);
  }

  function onSettingsSidebarKeyDown(event) {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const target = event.target instanceof Element ? event.target.closest("[data-settings-panel-slug], [data-codex-workflow-page]") : null;
    if (!target) return;
    const items = Array.from(state.settingsNav.querySelectorAll("[data-settings-panel-slug], [data-codex-workflow-page]"))
      .filter((item) => !item.closest("[hidden], [aria-hidden='true']") && getComputedStyle(item).display !== "none");
    event.preventDefault();
    event.stopPropagation();
    const next = items[items.indexOf(target) + (event.key === "ArrowDown" ? 1 : -1)];
    next?.focus();
    next?.click();
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
    syncSettingEffects();
    state.settingsWriteInFlight = true;
    refreshSettingControls();
    try {
      state.settings = normaliseSettings(
        await ipcRenderer.invoke("codex-workflow:settings:set", { [key]: next }),
      );
      syncSettingEffects();
    } catch (error) {
      state.settings = previousSettings;
      syncSettingEffects();
      log("error", `settings write failed: ${error?.stack || error}`);
    } finally {
      state.settingsWriteInFlight = false;
      refreshSettingControls();
    }
  }

  function refreshSettingControls() {
    syncSettingsSidebar();
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
    syncSidebarHelpShortcut();
    syncAccountMenuItems();
    syncHelpPopup();
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

  function syncSettingEffects() {
    syncFocusedInterfaceEffects();
    syncComposerMicrophone();
    syncSettingsSidebar();
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
    releaseSettingsSidebar();
    state.sidebarEditing = false;
    restoreNativeSettingsView();
    if (state.navWithListener) {
      state.navWithListener.removeEventListener("click", onSettingsNavClick, true);
      state.navWithListener.removeEventListener("keydown", onSettingsSidebarKeyDown, true);
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
      stopUpdatePillDiscovery();
      releaseUpdatePillHost();
      return;
    }

    const host = findUpdatePillHost(root);
    if (!host) {
      state.updatePillSlot?.remove();
      state.updatePillSlot = null;
      state.updatePill = null;
      releaseUpdatePillHost();
      beginUpdatePillDiscovery();
      return;
    }
    stopUpdatePillDiscovery();
    bindUpdatePillHost(host.element);

    let slot = state.updatePillSlot;
    if (!slot?.isConnected) {
      slot = document.createElement("div");
      slot.dataset.codexWorkflowUpdateSlot = "true";
      state.updatePillSlot = slot;
    }
    slot.className = host.globalTitlebar
      ? "pointer-events-none no-drag fixed z-30 flex items-center justify-end pe-3"
      : "pointer-events-auto flex h-full w-full items-center justify-end px-panel";
    if (host.globalTitlebar) {
      const rootRect = root.getBoundingClientRect();
      const titlebar = host.element.closest("header.h-toolbar.draggable");
      const titlebarRect = titlebar?.getBoundingClientRect();
      if (!titlebarRect) return;
      slot.style.left = `${rootRect.left}px`;
      slot.style.top = `${titlebarRect.top}px`;
      slot.style.width = `${rootRect.width}px`;
      slot.style.height = `${titlebarRect.height}px`;
    } else {
      slot.removeAttribute("style");
    }
    if (slot.parentElement !== host.element) host.element.append(slot);

    let button = state.updatePill;
    if (!button?.isConnected) {
      button = createUpdatePill();
      state.updatePill = button;
    }
    button.disabled = state.updateApplying;
    button.setAttribute("aria-label", state.updateApplying ? "Installing Workflow Update" : "Workflow Update");
    button.title = state.updateApplying ? "Installing Workflow Update" : "Workflow Update";
    syncUpdatePillMotion(button, host.globalTitlebar);
    if (button.parentElement !== slot) slot.append(button);
  }

  function findUpdatePillHost(root) {
    const toolbar = Array.from(root.children).find((child) => {
      if (!(child instanceof HTMLElement)) return false;
      const classes = child.classList;
      return classes.contains("h-toolbar") && classes.contains("draggable");
    });
    if (toolbar) return { element: toolbar, globalTitlebar: false };

    const rootRect = root.getBoundingClientRect();
    if (!(rootRect.width > 0 && rootRect.height > 0)) return null;
    const titlebars = Array.from(document.querySelectorAll("header.h-toolbar.draggable")).filter((candidate) => {
      if (!(candidate instanceof HTMLElement)) return false;
      const style = getComputedStyle(candidate);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = candidate.getBoundingClientRect();
      return rect.width >= rootRect.width && rect.height > 0 &&
        Math.abs(rect.left - rootRect.left) < 1 &&
        rect.top <= rootRect.top + 1 && rect.bottom > rootRect.top;
    });
    const matches = [];
    for (const titlebar of titlebars) {
      const titlebarRect = titlebar.getBoundingClientRect();
      const regions = Array.from(titlebar.children).filter((candidate) => {
        if (!(candidate instanceof HTMLElement)) return false;
        const style = getComputedStyle(candidate);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = candidate.getBoundingClientRect();
        return Math.abs(rect.left - rootRect.left) < 1 &&
          Math.abs(rect.width - rootRect.width) < 1 &&
          Math.abs(rect.height - titlebarRect.height) < 1;
      });
      if (regions.length !== 1) continue;

      const hosts = Array.from(regions[0].querySelectorAll("*")).filter((candidate) => {
        if (!(candidate instanceof HTMLElement)) return false;
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return ["flex", "inline-flex"].includes(style.display) &&
          style.visibility !== "hidden" && rect.width > 0 &&
          Math.abs(rect.height - titlebarRect.height) < 1 &&
          candidate.querySelectorAll("button[aria-label]").length >= 3;
      });
      if (hosts.length === 1) matches.push(hosts[0]);
    }
    return matches.length === 1 ? { element: matches[0], globalTitlebar: true } : null;
  }

  function beginUpdatePillDiscovery() {
    if (state.updatePillDiscoveryObserver) return;
    state.updatePillDiscoveryObserver = new MutationObserver((mutations) => {
      if (!mutations.some(mutationMayAffectUpdatePillHost)) return;
      try {
        syncUpdatePill();
      } catch (error) {
        log("error", `update pill discovery sync failed: ${error?.stack || error}`);
      }
    });
    state.updatePillDiscoveryObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function stopUpdatePillDiscovery() {
    state.updatePillDiscoveryObserver?.disconnect();
    state.updatePillDiscoveryObserver = null;
  }

  function mutationMayAffectUpdatePillHost(mutation) {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target?.parentElement;
    if (target?.closest?.("header.h-toolbar.draggable")) return true;
    return Array.from(mutation.addedNodes || []).some((node) => {
      if (!(node instanceof Element)) return false;
      return node.matches("header.h-toolbar.draggable") ||
        Boolean(node.querySelector("header.h-toolbar.draggable"));
    });
  }

  function bindUpdatePillHost(host) {
    if (state.updatePillHost === host && host.isConnected) return;
    releaseUpdatePillHost();
    state.updatePillHost = host;
    state.updatePillHostObserver = new MutationObserver(() => {
      try {
        syncUpdatePill();
      } catch (error) {
        log("error", `update pill host sync failed: ${error?.stack || error}`);
      }
    });
    state.updatePillHostObserver.observe(host, { childList: true });
    state.updatePillHostMountObservers = observeMountChain("update-pill", host);
    if (typeof ResizeObserver === "function") {
      state.updatePillResizeObserver = new ResizeObserver(() => scheduleWork("toolbar"));
      state.updatePillResizeObserver.observe(host);
      if (state.sidebarRoot) state.updatePillResizeObserver.observe(state.sidebarRoot);
    }
  }

  function releaseUpdatePillHost() {
    state.updatePillHostObserver?.disconnect();
    state.updatePillHostObserver = null;
    disconnectObservers(state.updatePillHostMountObservers);
    state.updatePillHostMountObservers = [];
    state.updatePillResizeObserver?.disconnect();
    state.updatePillResizeObserver = null;
    state.updatePillHost = null;
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
        const status = await ipcRenderer.invoke("codex-workflow:update:install");
        state.updateStatus = status || { available: false };
        state.updateApplying = Boolean(status?.applying);
        syncUpdatePill();
      } catch (error) {
        state.updateApplying = false;
        syncUpdatePill();
        log("error", `update launch failed: ${error?.stack || error}`);
      }
    });
    return button;
  }

  function syncUpdatePillMotion(button, compact = false) {
    const applying = state.updateApplying;
    const label = applying ? "Installing" : compact ? "Update" : "Workflow Update";
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
