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
const updaterPath = path.join(runtimeRoot, "runtime", "updater.cjs");
const defaults = {
  schemaVersion: 2,
  focusedInterface: true,
  hidePullRequests: true,
  hidePetMenuItem: true,
  hideInviteFriendMenuItem: true,
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
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function readUpdateStatus() {
  const config = readJson(updateConfigPath);
  const installedVersion = readJson(patchStatePath)?.patchVersion || null;
  const localVersion = config?.sourceRoot
    ? readJson(path.join(config.sourceRoot, "package.json"))?.version || null
    : null;
  const remote = readJson(updateStatePath);
  const versions = [localVersion, remote?.availableVersion]
    .filter((version) => versionParts(version) && compareVersions(version, installedVersion) > 0)
    .sort((left, right) => compareVersions(right, left));
  return {
    available: versions.length > 0,
    installedVersion,
    availableVersion: versions[0] || null,
    error: remote?.error || null,
  };
}

function broadcastUpdateStatus() {
  const status = readUpdateStatus();
  for (const contents of webContents?.getAllWebContents?.() || []) {
    if (!contents.isDestroyed?.()) contents.send("codex-workflow:update:status", status);
  }
}

function watchUpdateState() {
  try {
    fs.watch(path.dirname(updateStatePath), { persistent: false }, (_event, filename) => {
      if (filename === path.basename(updateStatePath)) broadcastUpdateStatus();
    });
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
  ipcMain.handle("codex-workflow:update:get", (event) => {
    assertTrustedSender(event);
    return readUpdateStatus();
  });
  ipcMain.handle("codex-workflow:update:install", async (event) => {
    assertTrustedSender(event);
    const status = readUpdateStatus();
    if (!status.available) return status;
    const config = readJson(updateConfigPath);
    if (!config?.nodeExecutable || !fs.existsSync(config.nodeExecutable)) {
      throw new Error("Workflow updater Node.js runtime is unavailable");
    }
    const child = spawn(config.nodeExecutable, [
      updaterPath,
      "--apply",
      "--relaunch",
      "--parent",
      String(process.pid),
    ], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CODEX_WORKFLOW_ROOT: runtimeRoot },
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    child.unref();
    setImmediate(() => app.quit());
    return { ...status, applying: true };
  });
  ipcMain.on("codex-workflow:log", (event, level, message) => {
    if (!isTrustedSender(event)) return;
    appendLog(level === "error" ? "error" : "info", message);
  });

  app.whenReady().then(() => {
    registerPreload(session.defaultSession, "defaultSession");
    watchUpdateState();
  });
  app.on("session-created", (createdSession) => registerPreload(createdSession, "session-created"));
  app.on("web-contents-created", (_event, contents) => {
    appendLog("info", `web contents created: ${contents.id} ${contents.getType()}`);
    contents.on("preload-error", (_preloadEvent, preload, error) => {
      appendLog("error", `preload error for ${preload}: ${error?.stack || error}`);
    });
  });
  appendLog("info", `runtime loaded for app ${app.getVersion()}`);
}
