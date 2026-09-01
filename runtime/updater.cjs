"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const runtimeRoot = process.env.CODEX_WORKFLOW_ROOT;
if (!runtimeRoot) throw new Error("CODEX_WORKFLOW_ROOT is not set");

const configPath = path.join(runtimeRoot, "update-config.json");
const statePath = path.join(runtimeRoot, "update-state.json");
const patchStatePath = path.join(runtimeRoot, "state.json");
const updatesRoot = path.join(runtimeRoot, "updates");
const logPath = path.join(runtimeRoot, "logs", "updater.log");
const remoteIntervalMs = 5 * 60 * 1000;

function appendLog(level, message) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] [${level}] ${String(message).replaceAll("\0", "").slice(0, 4096)}\n`,
      { mode: 0o600 },
    );
  } catch {}
}

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staged = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(staged, target);
  } finally {
    fs.rmSync(staged, { force: true });
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

function remoteCheckDue(state, now = Date.now()) {
  const checkedAt = Date.parse(state?.remoteCheckedAt || "");
  return !Number.isFinite(checkedAt) || now - checkedAt >= remoteIntervalMs;
}

function sourcePackage(sourceRoot) {
  const packagePath = path.join(sourceRoot, "package.json");
  const installPath = path.join(sourceRoot, "scripts", "install.mjs");
  const pkg = readJson(packagePath);
  if (!pkg || pkg.name !== "codex-workflow" || !versionParts(pkg.version) || !fs.existsSync(installPath)) {
    return null;
  }
  return { root: sourceRoot, version: pkg.version, installPath };
}

function installedVersion() {
  return readJson(patchStatePath)?.patchVersion || null;
}

function appIsRunning(executable) {
  const result = spawnSync("/bin/ps", ["-axo", "args="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Could not inspect the ChatGPT process list");
  return result.stdout.split("\n")
    .some((line) => line === executable || line.startsWith(`${executable} `));
}

async function waitForProcessExit(pid, timeoutMs = 30000) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function waitForAppExit(executable, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!appIsRunning(executable)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return !appIsRunning(executable);
}

function selectStagedCandidate(state, installed) {
  const candidate = state?.stagedSourceRoot
    ? sourcePackage(state.stagedSourceRoot)
    : null;
  if (
    !candidate ||
    state.availableVersion !== candidate.version ||
    compareVersions(candidate.version, installed) <= 0
  ) {
    return null;
  }
  return candidate;
}

function chooseCandidate() {
  const installed = installedVersion();
  return {
    installed,
    candidate: selectStagedCandidate(readJson(statePath), installed),
  };
}

function sha256(target) {
  return createHash("sha256").update(fs.readFileSync(target)).digest("hex");
}

function validateTarEntries(listing) {
  const entries = listing.split("\n").filter(Boolean);
  if (!entries.length) throw new Error("Workflow release archive is empty");
  for (const entry of entries) {
    const normal = path.posix.normalize(entry);
    if (path.posix.isAbsolute(entry) || normal === ".." || normal.startsWith("../")) {
      throw new Error("Workflow release archive contains an unsafe path");
    }
  }
}

function validateTarTypes(listing) {
  const entries = listing.split("\n").filter(Boolean);
  if (!entries.length || entries.some((entry) => !["-", "d"].includes(entry[0]))) {
    throw new Error("Workflow release archive contains an unsupported entry type");
  }
}

async function download(url, target) {
  const response = await fetch(url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "codex-workflow-updater" },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Workflow update download failed (${response.status})`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
}

async function checkRemote(config, previousState) {
  if (!config.releaseApi) return null;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "codex-workflow-updater",
  };
  const staged = previousState?.stagedSourceRoot
    ? sourcePackage(previousState.stagedSourceRoot)
    : null;
  const canReuseCachedRelease = staged && staged.version === previousState.availableVersion;
  if (canReuseCachedRelease && typeof previousState?.releaseEtag === "string" && previousState.releaseEtag) {
    headers["If-None-Match"] = previousState.releaseEtag;
  }
  const response = await fetch(config.releaseApi, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 304) {
    return { candidate: null, etag: previousState?.releaseEtag || null, unchanged: true };
  }
  if (response.status === 404) return { candidate: null, etag: null, unchanged: false };
  if (!response.ok) throw new Error(`Workflow release check failed (${response.status})`);
  const etag = response.headers.get("etag") || null;
  const release = await response.json();
  const version = String(release.tag_name || "").replace(/^v/u, "");
  if (!versionParts(version) || compareVersions(version, installedVersion()) <= 0) {
    return { candidate: null, etag, unchanged: false };
  }
  const assetName = `codex-workflow-${version}.tar.gz`;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((entry) => entry?.name === assetName)
    : null;
  if (!asset?.browser_download_url || !/^sha256:[0-9a-f]{64}$/iu.test(asset.digest || "")) {
    throw new Error(`Workflow release ${version} is missing its verified ${assetName} asset`);
  }

  const releaseRoot = path.join(updatesRoot, version);
  const archive = path.join(updatesRoot, `${version}.tar.gz`);
  fs.mkdirSync(updatesRoot, { recursive: true });
  await download(asset.browser_download_url, archive);
  if (sha256(archive) !== asset.digest.slice(7).toLowerCase()) {
    throw new Error("Workflow release asset digest does not match GitHub metadata");
  }
  const listing = spawnSync("/usr/bin/tar", ["-tzf", archive], { encoding: "utf8" });
  if (listing.status !== 0) throw new Error("Workflow release archive could not be inspected");
  validateTarEntries(listing.stdout);
  const verboseListing = spawnSync("/usr/bin/tar", ["-tvzf", archive], { encoding: "utf8" });
  if (verboseListing.status !== 0) throw new Error("Workflow release archive types could not be inspected");
  validateTarTypes(verboseListing.stdout);
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  fs.mkdirSync(releaseRoot, { recursive: true });
  const extracted = spawnSync("/usr/bin/tar", ["-xzf", archive, "-C", releaseRoot], { encoding: "utf8" });
  if (extracted.status !== 0) throw new Error("Workflow release archive could not be extracted");
  const children = fs.readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(releaseRoot, entry.name));
  const source = [releaseRoot, ...children].map(sourcePackage).find(Boolean);
  if (!source || source.version !== version) throw new Error("Workflow release archive has invalid contents");
  return { candidate: source, etag, unchanged: false };
}

function applyCandidate(config, candidate, relaunch) {
  appendLog("info", `Applying Workflow ${candidate.version} from ${candidate.root}`);
  const result = spawnSync(config.nodeExecutable, [candidate.installPath, "--reapply"], {
    encoding: "utf8",
    env: { ...process.env, CODEX_WORKFLOW_ROOT: runtimeRoot },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Workflow update failed").trim());
  }
  writeJsonAtomic(statePath, {
    ...(readJson(statePath) || {}),
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    appliedVersion: candidate.version,
    availableVersion: null,
    stagedSourceRoot: null,
    error: null,
  });
  if (relaunch) {
    const opened = spawnSync("/usr/bin/open", [config.appRoot], { encoding: "utf8" });
    if (opened.status !== 0) throw new Error("Workflow updated, but ChatGPT could not be relaunched");
  }
  appendLog("info", `Workflow ${candidate.version} applied successfully`);
}

async function run() {
  const config = readJson(configPath);
  if (!config || config.schemaVersion !== 1 || !config.nodeExecutable || !config.appExecutable || !config.appRoot) {
    throw new Error("Workflow updater configuration is missing or invalid");
  }
  if (!fs.existsSync(config.nodeExecutable)) throw new Error("Workflow updater Node.js runtime is unavailable");
  const apply = process.argv.includes("--apply");
  const background = process.argv.includes("--background");
  const relaunch = process.argv.includes("--relaunch");
  const parentIndex = process.argv.indexOf("--parent");
  const parentPid = parentIndex >= 0 ? Number(process.argv[parentIndex + 1]) : null;
  appendLog("info", `Updater started (${apply ? "apply" : background ? "background" : "check"})`);

  const previousState = readJson(statePath) || {};
  const installed = installedVersion();
  const existingCandidate = selectStagedCandidate(previousState, installed);
  const shouldCheckRemote = apply || remoteCheckDue(previousState);
  let remoteResult = null;
  let checkError = null;
  if (shouldCheckRemote) {
    try {
      remoteResult = await checkRemote(config, previousState);
    } catch (error) {
      checkError = String(error?.message || error).slice(0, 1000);
    }
  }
  let candidate = existingCandidate;
  if (remoteResult?.candidate) candidate = remoteResult.candidate;
  else if (remoteResult && !remoteResult.unchanged) candidate = null;
  const checkedAt = new Date().toISOString();
  writeJsonAtomic(statePath, {
    ...previousState,
    schemaVersion: 1,
    checkedAt,
    remoteCheckedAt: shouldCheckRemote && !checkError
      ? checkedAt
      : previousState.remoteCheckedAt || null,
    releaseEtag: remoteResult
      ? remoteResult.etag
      : previousState.releaseEtag || null,
    installedVersion: installed,
    availableVersion: candidate?.version || null,
    stagedSourceRoot: candidate?.root || null,
    error: checkError,
  });
  if (!candidate || (!apply && !background)) {
    appendLog("info", candidate ? `Workflow ${candidate.version} is available` : "No Workflow update is available");
    return;
  }

  if (apply && parentPid) {
    if (!await waitForProcessExit(parentPid)) {
      throw new Error("ChatGPT did not exit in time for the Workflow update");
    }
  }
  if (!await waitForAppExit(config.appExecutable)) {
    throw new Error("ChatGPT is still running; Workflow update was not applied");
  }
  applyCandidate(config, candidate, relaunch);
}

if (require.main === module) {
  run().catch((error) => {
    appendLog("error", error?.stack || error);
    const previous = readJson(statePath) || {};
    writeJsonAtomic(statePath, {
      ...previous,
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      error: String(error?.stack || error).slice(0, 4000),
    });
    process.exitCode = 1;
  });
}

module.exports = { checkRemote, compareVersions, remoteCheckDue, chooseCandidate, selectStagedCandidate, sourcePackage, validateTarEntries, validateTarTypes, waitForProcessExit };
