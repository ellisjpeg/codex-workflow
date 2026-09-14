"use strict";

const { app, ipcMain, session, webContents } = require("electron");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const runtimeRoot = process.env.CODEX_WORKFLOW_ROOT;
if (!runtimeRoot) throw new Error("CODEX_WORKFLOW_ROOT is not set");

const preloadPath = path.join(runtimeRoot, "runtime", "preload.cjs");
const settingsPath = path.join(runtimeRoot, "settings.json");
const disabledPath = path.join(runtimeRoot, "DISABLED");
const logDir = path.join(runtimeRoot, "logs");
const logPath = path.join(logDir, "runtime.log");
const updateConfigPath = path.join(runtimeRoot, "update-config.json");
const updateStatePath = path.join(runtimeRoot, "update-state.json");
const patchStatePath = path.join(runtimeRoot, "state.json");
const runtimeVersionPath = path.join(runtimeRoot, "runtime", "version.json");
const transactionPath = path.join(runtimeRoot, "transaction.json");
const updaterPath = path.join(runtimeRoot, "runtime", "updater.cjs");
const updateWatchers = [];
let updateLaunchInFlight = false;
let updateCheckInFlight = false;
const defaults = {
  schemaVersion: 5,
  focusedInterface: true,
  hidePullRequests: true,
  hidePetMenuItem: true,
  hideInviteFriendMenuItem: true,
  replaceHelpWithSettings: true,
  hideComposerMicrophone: false,
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
    settingsOrder: [],
    settingsHidden: [],
    accountOrder: ["usage", "pet", "invite", "settings", "logout"],
    accountHidden: [],
  },
};

fs.mkdirSync(logDir, { recursive: true });

function appendLog(level, message) {
  try {
    const safeMessage = String(message).replaceAll("\0", "").slice(0, 4096);
    const line = `[${new Date().toISOString()}] [${level}] ${safeMessage}\n`;
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
      const tail = fs.readFileSync(logPath).subarray(-512 * 1024);
      fs.writeFileSync(logPath, tail);
    }
    fs.appendFileSync(logPath, line);
  } catch {}
}

function normaliseSettings(value) {
  const legacyFocusedInterface = typeof value?.efficiencyMode === "boolean"
    ? value.efficiencyMode
    : defaults.focusedInterface;
  const sidebarDefaults = defaults.sidebarNavigation;
  const sidebarNavigation = value?.sidebarNavigation &&
    typeof value.sidebarNavigation === "object" && !Array.isArray(value.sidebarNavigation)
    ? value.sidebarNavigation
    : value?.schemaVersion < 3 ? {
      hidden: [value.hidePullRequests === true && "pull-requests", value.replaceHelpWithSettings === false && "settings-shortcut"].filter(Boolean),
      settingsHidden: value.hiddenSettingsPages,
      accountHidden: [value.hidePetMenuItem === true && "pet", value.hideInviteFriendMenuItem === true && "invite"].filter(Boolean),
    } : {};
  const builtins = sidebarDefaults.order.filter(id => id !== "settings-shortcut");
  const allowed = [...sidebarDefaults.order, "usage-shortcut", "whats-new-shortcut", "workflow-shortcut", "profile-shortcut"];
  const sidebarOrder = Array.isArray(sidebarNavigation.order) ? sidebarNavigation.order.slice(0, 100) : sidebarDefaults.order;
  const order = [...new Set([...sidebarOrder, ...(value?.schemaVersion >= 4 ? builtins : sidebarDefaults.order)]
    .map(id => id === "general-shortcut" ? "settings-shortcut" : id).filter(id => allowed.includes(id)))];
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
        ["settings-shortcut", "usage-shortcut", "whats-new-shortcut", "workflow-shortcut", "profile-shortcut"].includes(sidebarNavigation.footerShortcut) ? sidebarNavigation.footerShortcut : sidebarDefaults.footerShortcut,
      hidden: Array.isArray(sidebarNavigation.hidden)
        ? [...new Set(sidebarNavigation.hidden.slice(0, 100).map(id => id === "general-shortcut" ? "settings-shortcut" : id).filter((id) =>
          order.includes(id)))]
        : [...sidebarDefaults.hidden],
      width: Number.isFinite(sidebarNavigation.width)
        ? Math.min(520, Math.max(240, Math.round(sidebarNavigation.width)))
        : sidebarDefaults.width,
      showRecentChats: typeof sidebarNavigation.showRecentChats === "boolean"
        ? sidebarNavigation.showRecentChats
        : sidebarDefaults.showRecentChats,
      settingsOrder: normaliseNavigationIds(sidebarNavigation.settingsOrder),
      settingsHidden: normaliseNavigationIds(sidebarNavigation.settingsHidden).filter((id) => id !== "workflow"),
      accountOrder: [...new Set([...normaliseNavigationIds(sidebarNavigation.accountOrder),
        ...sidebarDefaults.accountOrder].filter((id) => sidebarDefaults.accountOrder.includes(id)))],
      accountHidden: normaliseNavigationIds(sidebarNavigation.accountHidden)
        .filter((id) => ["usage", "pet", "invite"].includes(id)),
    },
  };
}

function normaliseNavigationIds(value) {
  return Array.isArray(value) ? [...new Set(value.slice(0, 100).filter((id) =>
    typeof id === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(id)))] : [];
}

function readSettings() {
  try {
    return normaliseSettings(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
  } catch {
    return { ...defaults };
  }
}

function writeSettings(patch) {
  const next = normaliseSettings({ ...readSettings(), ...patch });
  const tempPath = path.join(runtimeRoot, `.settings-${process.pid}-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, settingsPath);
    const directory = fs.openSync(runtimeRoot, "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  return next;
}

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

function versionParts(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u);
  // Check the whole match too: JavaScript's $ may precede a final newline.
  if (!match || match[0] !== value) return null;
  const core = match.slice(1, 4).map(Number);
  const prerelease = match[4]?.split(".") || [];
  if (!core.every(Number.isSafeInteger) || prerelease.some(id => /^0\d+$/u.test(id))) return null;
  return { core, prerelease };
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftId = a.prerelease[index];
    const rightId = b.prerelease[index];
    if (leftId === rightId) continue;
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    const leftNumeric = /^\d+$/u.test(leftId);
    const rightNumeric = /^\d+$/u.test(rightId);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    // Equal-length decimal strings compare exactly, even beyond Number precision.
    if (leftNumeric && leftId.length !== rightId.length) return leftId.length > rightId.length ? 1 : -1;
    return leftId > rightId ? 1 : -1;
  }
  return 0;
}

function readStagedUpdate(remote, installedVersion, updateConfig) {
  if (typeof remote?.stagedSourceRoot !== "string" || !remote.stagedSourceRoot) return null;
  const pkg = readJson(path.join(remote.stagedSourceRoot, "package.json"));
  const compatibility = readJson(path.join(remote.stagedSourceRoot, "workflow-compatibility.json"));
  const installPath = path.join(remote.stagedSourceRoot, "scripts", "install.mjs");
  const runtimeInstallPath = path.join(remote.stagedSourceRoot, "scripts", "install-runtime.mjs");
  if (
    pkg?.name !== "codex-workflow" ||
    !versionParts(pkg.version) ||
    remote.availableVersion !== pkg.version ||
    compatibility?.schemaVersion !== 1 ||
    compatibility.workflowVersion !== pkg.version ||
    compatibility.codexVersion !== updateConfig?.codexVersion ||
    compatibility.codexBuild !== updateConfig?.codexBuild ||
    compatibility.bundleIdentifier !== updateConfig?.bundleIdentifier ||
    compatibility.packageName !== updateConfig?.packageName ||
    compareVersions(pkg.version, installedVersion) <= 0 ||
    !fs.existsSync(installPath) ||
    !fs.existsSync(runtimeInstallPath)
  ) {
    return null;
  }
  return { version: pkg.version, root: remote.stagedSourceRoot };
}

function readUpdateStatus() {
  const installedVersion = readJson(runtimeVersionPath)?.version ||
    readJson(patchStatePath)?.runtimeVersion ||
    readJson(patchStatePath)?.patchVersion ||
    null;
  const updateConfig = readJson(updateConfigPath);
  const remote = readJson(updateStatePath);
  const staged = readStagedUpdate(remote, installedVersion, updateConfig);
  const blockedReason = updateConfig?.updatesDisabled === true
    ? "updates-disabled"
    : fs.existsSync(transactionPath) ? "recovery-required" : null;
  return {
    available: Boolean(staged) && !blockedReason,
    installedVersion,
    availableVersion: staged?.version || null,
    blockedReason,
    error: remote?.error || null,
  };
}

function updateCheckDue() {
  const remote = readJson(updateStatePath) || {};
  const nextCheckAt = Date.parse(remote.nextRemoteCheckAt || "");
  if (Number.isFinite(nextCheckAt)) return Date.now() >= nextCheckAt;
  const checkedAt = Date.parse(remote.remoteCheckedAt || "");
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt >= 5 * 60 * 1000;
}

function triggerUpdateCheck() {
  if (updateCheckInFlight || !updateCheckDue()) return;
  const config = readJson(updateConfigPath);
  if (!config?.nodeExecutable || !fs.existsSync(config.nodeExecutable)) return;
  updateCheckInFlight = true;
  let finished = false;
  const finish = (error) => {
    if (finished) return;
    finished = true;
    updateCheckInFlight = false;
    if (error) appendLog("error", `Workflow update check failed: ${error}`);
    broadcastUpdateStatus();
  };
  try {
    const child = spawn(config.nodeExecutable, [updaterPath, "--check"], {
      stdio: "ignore",
      env: { ...process.env, CODEX_WORKFLOW_ROOT: runtimeRoot },
    });
    child.once("error", (error) => finish(error?.message || error));
    child.once("close", (code, signal) => finish(
      code === 0 ? null : signal ? `signal ${signal}` : `exit ${code}`,
    ));
  } catch (error) {
    finish(error?.message || error);
  }
}

function broadcastUpdateStatus() {
  const status = readUpdateStatus();
  for (const contents of webContents?.getAllWebContents?.() || []) {
    if (!contents.isDestroyed?.()) contents.send("codex-workflow:update:status", status);
  }
}

function watchUpdateState() {
  try {
    const watcher = fs.watch(path.dirname(updateStatePath), { persistent: false }, (_event, filename) => {
      if (String(filename || "") === path.basename(updateStatePath)) broadcastUpdateStatus();
    });
    updateWatchers.push(watcher);
  } catch (error) {
    appendLog("error", `update state watch failed: ${error?.message || error}`);
  }
}

function isTrustedSender(event) {
  const url = event.senderFrame?.url || event.sender?.getURL?.() || "";
  return url.startsWith("app://");
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error("Codex Workflow rejected an untrusted renderer");
}

// Build 8881: native Wsi/Gsi read/write sidebar-width through jh/Mh.
// Settings unmounts the app sidebar. Updating the same native store makes the
// next app mount use this width, while manual dragging keeps its normal ownership.
function nativeSidebarWidthScript(width) {
  return `(async () => {
    if (!document.querySelector('nav[aria-label="Settings"]')) throw Error('Open Settings first');
    const native = await import('app://-/assets/app-initial-9b95fa538c62.js');
    if (typeof native.X4t !== 'function' || typeof native.e3t !== 'function') throw Error('Unsupported sidebar store');
    ${width === undefined ? "" : `native.e3t('sidebar-width', ${width});`}
    const value = native.X4t('sidebar-width', 275);
    return Number.isFinite(value) ? Math.max(240, Math.min(520, Math.round(value))) : 275;
  })()`;
}

function registerPreload(targetSession, label) {
  if (fs.existsSync(disabledPath)) {
    appendLog("info", `patch disabled; skipped ${label}`);
    return;
  }
  try {
    if (typeof targetSession.registerPreloadScript === "function") {
      targetSession.registerPreloadScript({
        id: "codex-workflow",
        type: "frame",
        filePath: preloadPath,
      });
      appendLog("info", `registered preload on ${label}`);
      return;
    }
    appendLog("error", `registerPreloadScript unavailable on ${label}; sandbox fallback is unsupported`);
  } catch (error) {
    if (String(error?.message || error).includes("existing ID")) return;
    appendLog("error", `preload registration failed on ${label}: ${error?.stack || error}`);
  }
}

if (!globalThis.__codexWorkflowMainInstalled) {
  globalThis.__codexWorkflowMainInstalled = true;

  ipcMain.handle("codex-workflow:settings:get", (event) => {
    assertTrustedSender(event);
    return readSettings();
  });
  ipcMain.handle("codex-workflow:settings:set", (event, patch) => {
    assertTrustedSender(event);
    return writeSettings(patch);
  });
  ipcMain.handle("codex-workflow:sidebar-width", async (event, request) => {
    assertTrustedSender(event);
    const contents = event.sender;
    if (!contents || contents.isDestroyed() || event.senderFrame !== contents.mainFrame ||
      !/^app:\/\/-\/index\.html(?:[?#]|$)/u.test(contents.getURL())) {
      throw new Error("Codex Workflow rejected sidebar width access");
    }
    if (request?.action === "get") return contents.executeJavaScript(nativeSidebarWidthScript());
    if (request?.action !== "set" || !Number.isInteger(request.width) ||
      request.width < 240 || request.width > 520) {
      throw new Error("Invalid sidebar width");
    }
    return contents.executeJavaScript(nativeSidebarWidthScript(request.width));
  });
  ipcMain.handle("codex-workflow:settings:activate", (event, request) => {
    assertTrustedSender(event);
    const contents = event.sender;
    if (contents?.isDestroyed?.() || request?.target !== "keyboard-shortcut") {
      throw new Error("Codex Workflow rejected invalid Settings activation");
    }
    contents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
    return true;
  });
  ipcMain.handle("codex-workflow:update:get", (event) => {
    assertTrustedSender(event);
    return readUpdateStatus();
  });
  ipcMain.handle("codex-workflow:update:install", async (event) => {
    assertTrustedSender(event);
    const status = readUpdateStatus();
    if (!status.available) return status;
    if (updateLaunchInFlight) return { ...status, applying: true };
    const config = readJson(updateConfigPath);
    if (!config?.nodeExecutable || !fs.existsSync(config.nodeExecutable)) {
      throw new Error("Workflow updater Node.js runtime is unavailable");
    }
    updateLaunchInFlight = true;
    let appliedStatus;
    appendLog("info", `Workflow update requested: ${status.installedVersion || "unknown"} -> ${status.availableVersion || "unknown"}`);
    try {
      const child = spawn(config.nodeExecutable, [updaterPath, "--apply"], {
        stdio: "ignore",
        env: { ...process.env, CODEX_WORKFLOW_ROOT: runtimeRoot },
      });
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (code === 0) resolve();
          else reject(new Error(`Workflow updater exited ${signal ? `with ${signal}` : `with code ${code}`}`));
        });
      });
      appliedStatus = readUpdateStatus();
      if (appliedStatus.installedVersion !== status.availableVersion || appliedStatus.blockedReason || appliedStatus.error) {
        throw new Error("Workflow update did not complete cleanly; Codex was not relaunched");
      }
      appendLog("info", `Workflow update applied by process ${child.pid || "unknown"}`);
    } catch (error) {
      updateLaunchInFlight = false;
      appendLog("error", `Workflow updater failed: ${error?.stack || error}`);
      throw error;
    }
    setImmediate(() => {
      app.relaunch();
      app.exit(0);
    });
    return { ...appliedStatus, applying: true };
  });
  ipcMain.on("codex-workflow:log", (event, level, message) => {
    if (!isTrustedSender(event)) return;
    appendLog(level === "error" ? "error" : "info", message);
  });

  app.whenReady().then(() => {
    registerPreload(session.defaultSession, "defaultSession");
    watchUpdateState();
    triggerUpdateCheck();
  });
  app.on("browser-window-focus", triggerUpdateCheck);
  app.on("session-created", (createdSession) => registerPreload(createdSession, "session-created"));
  app.on("web-contents-created", (_event, contents) => {
    appendLog("info", `web contents created: ${contents.id} ${contents.getType()}`);
    contents.on("preload-error", (_preloadEvent, preload, error) => {
      appendLog("error", `preload error for ${preload}: ${error?.stack || error}`);
    });
  });
  appendLog("info", `runtime loaded for app ${app.getVersion()}`);
}
