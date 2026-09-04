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
const runtimeVersionPath = path.join(runtimeRoot, "runtime", "version.json");
const updatesRoot = path.join(runtimeRoot, "updates");
const logPath = path.join(runtimeRoot, "logs", "updater.log");
const remoteIntervalMs = 5 * 60 * 1000;
const maximumBackoffMs = 60 * 60 * 1000;
const compatibilityManifestName = "workflow-compatibility.json";

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

function releaseVersionEligible(version, installed, allowEqual = false) {
  if (!versionParts(version) || !versionParts(installed)) return false;
  const comparison = compareVersions(version, installed);
  return comparison > 0 || (allowEqual && version === installed);
}

function remoteCheckDue(state, now = Date.now()) {
  const nextCheckAt = Date.parse(state?.nextRemoteCheckAt || "");
  if (Number.isFinite(nextCheckAt)) return now >= nextCheckAt;
  const checkedAt = Date.parse(state?.remoteCheckedAt || "");
  return !Number.isFinite(checkedAt) || now - checkedAt >= remoteIntervalMs;
}

function remoteBackoffMs(failureCount) {
  const exponent = Math.max(0, Math.min(Number(failureCount) - 1, 8));
  return Math.min(remoteIntervalMs * (2 ** exponent), maximumBackoffMs);
}

function compatibilityManifest(sourceRoot, workflowVersion) {
  const value = readJson(path.join(sourceRoot, compatibilityManifestName));
  if (
    value?.schemaVersion !== 1 ||
    value.workflowVersion !== workflowVersion ||
    !/^[a-z0-9][a-z0-9._+-]{0,127}$/iu.test(String(value.codexVersion || "")) ||
    !/^[a-z0-9][a-z0-9._+-]{0,127}$/iu.test(String(value.codexBuild || "")) ||
    !/^[a-z0-9][a-z0-9.-]{1,127}$/iu.test(String(value.bundleIdentifier || "")) ||
    !/^[a-z0-9][a-z0-9._-]{1,127}$/iu.test(String(value.packageName || ""))
  ) {
    return null;
  }
  return value;
}

function sourcePackage(sourceRoot) {
  const packagePath = path.join(sourceRoot, "package.json");
  const installPath = path.join(sourceRoot, "scripts", "install.mjs");
  const runtimeInstallPath = path.join(sourceRoot, "scripts", "install-runtime.mjs");
  const statusPath = path.join(sourceRoot, "scripts", "status.mjs");
  const pkg = readJson(packagePath);
  const compatibility = compatibilityManifest(sourceRoot, pkg?.version);
  if (
    !pkg ||
    pkg.name !== "codex-workflow" ||
    !versionParts(pkg.version) ||
    !compatibility ||
    !fs.existsSync(installPath) ||
    !fs.existsSync(runtimeInstallPath) ||
    !fs.existsSync(statusPath)
  ) {
    return null;
  }
  return { root: sourceRoot, version: pkg.version, installPath, runtimeInstallPath, statusPath, compatibility };
}

function installedVersion() {
  return readJson(runtimeVersionPath)?.version ||
    readJson(patchStatePath)?.runtimeVersion ||
    readJson(patchStatePath)?.patchVersion ||
    null;
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

function compatibilityMatches(candidate, identity) {
  if (!identity) return true;
  const compatibility = candidate?.compatibility;
  return Boolean(compatibility) &&
    compatibility.codexVersion === identity.version &&
    compatibility.codexBuild === identity.build &&
    compatibility.bundleIdentifier === identity.bundleIdentifier &&
    compatibility.packageName === identity.packageName;
}

function eligibleReleaseCandidate(candidate, installed, identity, allowEqual = false) {
  return candidate &&
    releaseVersionEligible(candidate.version, installed, allowEqual) &&
    compatibilityMatches(candidate, identity)
    ? candidate
    : null;
}

function selectStagedCandidate(state, installed, identity = null) {
  const candidate = state?.stagedSourceRoot
    ? sourcePackage(state.stagedSourceRoot)
    : null;
  if (
    !candidate ||
    state.availableVersion !== candidate.version ||
    !eligibleReleaseCandidate(candidate, installed, identity)
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

function plistValue(target, key) {
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, target], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Could not inspect Codex ${key}`);
  }
  return result.stdout.trim();
}

function liveAppIdentity(config) {
  const plist = path.join(config.appRoot, "Contents", "Info.plist");
  if (!fs.existsSync(plist)) throw new Error("Codex Info.plist is unavailable");
  return {
    version: plistValue(plist, "CFBundleShortVersionString"),
    build: plistValue(plist, "CFBundleVersion"),
    bundleIdentifier: plistValue(plist, "CFBundleIdentifier"),
    packageName: config.packageName,
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
  const cachedReleaseVersion = previousState?.releaseVersion || previousState?.availableVersion;
  const installed = installedVersion();
  const cachedComparison = versionParts(cachedReleaseVersion) && versionParts(installed)
    ? compareVersions(cachedReleaseVersion, installed)
    : null;
  const hasCachedSource = staged?.version === cachedReleaseVersion;
  const needsEqualRepairSource = config.autoRepairCodexUpdates === true &&
    !hasCachedSource &&
    cachedReleaseVersion === installed;
  const canReuseCachedRelease = hasCachedSource ||
    (!needsEqualRepairSource && cachedComparison !== null && cachedComparison <= 0);
  if (canReuseCachedRelease && typeof previousState?.releaseEtag === "string" && previousState.releaseEtag) {
    headers["If-None-Match"] = previousState.releaseEtag;
  }
  const response = await fetch(config.releaseApi, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 304) {
    return {
      candidate: null,
      etag: previousState?.releaseEtag || null,
      releaseVersion: cachedReleaseVersion || null,
      unchanged: true,
    };
  }
  if (response.status === 404) {
    return { candidate: null, etag: null, releaseVersion: null, unchanged: false };
  }
  if (!response.ok) throw new Error(`Workflow release check failed (${response.status})`);
  const etag = response.headers.get("etag") || null;
  const release = await response.json();
  const version = String(release.tag_name || "").replace(/^v/u, "");
  if (!releaseVersionEligible(version, installedVersion(), config.autoRepairCodexUpdates === true)) {
    return { candidate: null, etag, releaseVersion: versionParts(version) ? version : null, unchanged: false };
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
  return { candidate: source, etag, releaseVersion: version, unchanged: false };
}

function applyCandidate(config, candidate) {
  appendLog("info", `Applying Workflow ${candidate.version} from ${candidate.root}`);
  const result = spawnSync(config.nodeExecutable, [candidate.runtimeInstallPath], {
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
  appendLog("info", `Workflow ${candidate.version} applied successfully`);
}

function inspectCandidateStatus(config, candidate) {
  const result = spawnSync(config.nodeExecutable, [candidate.statusPath], {
    encoding: "utf8",
    env: { ...process.env, CODEX_WORKFLOW_ROOT: runtimeRoot },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Workflow status inspection failed").trim());
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Workflow status inspection returned invalid output");
  }
}

function automaticRepairDecision(config, candidate, identity, status, previousState) {
  const key = candidate && identity
    ? `${candidate.version}:${identity.version}:${identity.build}:${status?.integrity?.computed || "unknown"}`
    : null;
  if (config?.autoRepairCodexUpdates !== true) return { eligible: false, reason: "disabled", key };
  if (!candidate || !compatibilityMatches(candidate, identity)) {
    return { eligible: false, reason: "no-compatible-release", key };
  }
  if (status?.pendingTransaction || status?.error) {
    return { eligible: false, reason: "recovery-required", key };
  }
  if (status?.patched) return { eligible: false, reason: "already-patched", key };
  if (status?.recommendedAction !== "install") {
    return { eligible: false, reason: "unsupported-state", key };
  }
  if (
    previousState?.automaticRepair?.key === key &&
    ["applying", "failed", "installed-relaunch-failed"].includes(previousState.automaticRepair.status)
  ) {
    return { eligible: false, reason: "attempt-already-recorded", key };
  }
  return { eligible: true, reason: null, key };
}

function automaticRepairWaitState(
  config,
  candidate,
  identity,
  patchState,
  previousState,
  now = new Date(),
) {
  const installed = patchState?.installed;
  if (
    config?.autoRepairCodexUpdates !== true ||
    candidate ||
    !identity ||
    !installed ||
    (installed.version === identity.version && String(installed.build) === String(identity.build))
  ) {
    return null;
  }
  const key = `awaiting-compatible-release:${identity.version}:${identity.build}`;
  if (
    previousState?.automaticRepair?.key === key &&
    previousState.automaticRepair.status === "awaiting-compatible-release"
  ) {
    return null;
  }
  return {
    key,
    status: "awaiting-compatible-release",
    reason: "no-compatible-release",
    appVersion: identity.version,
    appBuild: identity.build,
    updatedAt: now.toISOString(),
  };
}

function nextAutomaticRepairState(config, repairWait, identity, patchState, previousState) {
  if (repairWait) return repairWait;
  if (
    config?.autoRepairCodexUpdates !== true &&
    previousState?.automaticRepair?.status === "awaiting-compatible-release"
  ) {
    return null;
  }
  const installedIdentityCurrent = patchState?.installed?.version === identity?.version &&
    String(patchState?.installed?.build) === String(identity?.build);
  if (
    previousState?.automaticRepair?.status === "awaiting-compatible-release" &&
    installedIdentityCurrent
  ) {
    return null;
  }
  return previousState?.automaticRepair || null;
}

function notifyRepairRequired(runProcess = spawnSync) {
  const result = runProcess("/usr/bin/osascript", [
    "-e",
    'display notification "Codex was updated. Workflow is waiting for a compatible verified repair." with title "Codex Workflow"',
  ], { encoding: "utf8", timeout: 5000 });
  return result.status === 0;
}

function bundleInUse(targetRoot) {
  const result = spawnSync("/usr/sbin/lsof", ["-nP", "+D", targetRoot], { stdio: "ignore" });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error("Could not verify Codex bundle quiescence");
}

async function waitForBundleQuiescence(config, timeoutMs = 15000) {
  if (appIsRunning(config.appExecutable)) return false;
  const deadline = Date.now() + timeoutMs;
  let quietReads = 0;
  do {
    if (appIsRunning(config.appExecutable) || bundleInUse(config.appRoot)) {
      quietReads = 0;
    } else {
      quietReads += 1;
      if (quietReads === 2) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return false;
}

async function applyAutomaticRepair(config, candidate, identity, previousState, hooks = {}) {
  const inspect = hooks.inspectCandidateStatus || inspectCandidateStatus;
  const waitForQuiet = hooks.waitForBundleQuiescence || waitForBundleQuiescence;
  const runProcess = hooks.spawnSync || spawnSync;
  const readState = hooks.readState || (() => readJson(statePath) || {});
  const writeState = hooks.writeState || ((value) => writeJsonAtomic(statePath, value));
  const before = inspect(config, candidate);
  const decision = automaticRepairDecision(config, candidate, identity, before, previousState);
  if (!decision.eligible) return false;
  if (!await waitForQuiet(config)) {
    if (
      previousState?.automaticRepair?.key !== decision.key ||
      previousState.automaticRepair.status !== "waiting"
    ) {
      appendLog("info", "Automatic repair deferred until the Codex bundle is quiescent");
      writeState({
        ...readState(),
        automaticRepair: { key: decision.key, status: "waiting", updatedAt: new Date().toISOString() },
      });
    }
    return false;
  }
  writeState({
    ...readState(),
    automaticRepair: { key: decision.key, status: "applying", updatedAt: new Date().toISOString() },
  });
  appendLog("info", `Automatically restoring Workflow ${candidate.version} for Codex ${identity.version} (${identity.build})`);
  try {
    const applied = runProcess(config.nodeExecutable, [candidate.installPath, "--auto-repair"], {
      encoding: "utf8",
      env: { ...process.env, CODEX_WORKFLOW_ROOT: runtimeRoot },
    });
    if (applied.status !== 0) {
      throw new Error((applied.stderr || applied.stdout || "Automatic Workflow repair failed").trim());
    }
    const verified = inspect(config, candidate);
    if (
      !verified.ok ||
      !verified.patched ||
      verified.pendingTransaction ||
      verified.installedWorkflowVersion !== candidate.version ||
      verified.loaderCurrent !== true ||
      verified.runtimeCurrent !== true ||
      verified.sourceCurrent !== true ||
      verified.appVersion !== identity.version ||
      verified.appBuild !== identity.build ||
      verified.integrity?.matches !== true ||
      verified.signature?.valid !== true
    ) {
      throw new Error("Automatic Workflow repair did not pass installed hash, integrity, and signature verification");
    }
    const opened = runProcess("/usr/bin/open", [config.appRoot], { encoding: "utf8" });
    const finalStatus = opened.status === 0 ? "relaunched" : "installed-relaunch-failed";
    const error = opened.status === 0
      ? null
      : (opened.stderr || opened.stdout || "Codex could not be relaunched").trim();
    writeState({
      ...readState(),
      installedVersion: candidate.version,
      availableVersion: null,
      stagedSourceRoot: null,
      error,
      automaticRepair: { key: decision.key, status: finalStatus, updatedAt: new Date().toISOString() },
    });
    if (error) {
      appendLog("error", `Workflow was restored but Codex could not be relaunched: ${error}`);
      return false;
    }
    appendLog("info", `Workflow ${candidate.version} restored and Codex relaunched`);
    return true;
  } catch (error) {
    writeState({
      ...readState(),
      error: String(error?.stack || error).slice(0, 4000),
      automaticRepair: { key: decision.key, status: "failed", updatedAt: new Date().toISOString() },
    });
    throw error;
  }
}

async function run() {
  const config = readJson(configPath);
  if (
    !config ||
    config.schemaVersion !== 1 ||
    !config.nodeExecutable ||
    !config.appExecutable ||
    !config.appRoot ||
    !config.packageName
  ) {
    throw new Error("Workflow updater configuration is missing or invalid");
  }
  if (!fs.existsSync(config.nodeExecutable)) throw new Error("Workflow updater Node.js runtime is unavailable");
  const apply = process.argv.includes("--apply");
  const background = process.argv.includes("--background");
  if (!background) appendLog("info", `Updater started (${apply ? "apply" : "check"})`);

  const previousState = readJson(statePath) || {};
  const installed = installedVersion();
  const identity = liveAppIdentity(config);
  let stagedRelease = previousState.stagedSourceRoot
    ? sourcePackage(previousState.stagedSourceRoot)
    : null;
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
  if (remoteResult?.candidate) stagedRelease = remoteResult.candidate;
  else if (remoteResult && !remoteResult.unchanged) stagedRelease = null;
  const candidate = eligibleReleaseCandidate(stagedRelease, installed, identity);
  const automaticRepairCandidate = eligibleReleaseCandidate(
    stagedRelease,
    installed,
    identity,
    config.autoRepairCodexUpdates === true,
  );
  const checkedAt = new Date();
  const failureCount = shouldCheckRemote
    ? checkError ? Math.min(Number(previousState.remoteFailureCount || 0) + 1, 9) : 0
    : Number(previousState.remoteFailureCount || 0);
  const patchState = readJson(patchStatePath);
  const repairWait = background
    ? automaticRepairWaitState(
      config,
      automaticRepairCandidate,
      identity,
      patchState,
      previousState,
    )
    : null;
  const automaticRepair = nextAutomaticRepairState(
    config,
    repairWait,
    identity,
    patchState,
    previousState,
  );
  writeJsonAtomic(statePath, {
    ...previousState,
    schemaVersion: 1,
    checkedAt: checkedAt.toISOString(),
    remoteAttemptedAt: shouldCheckRemote
      ? checkedAt.toISOString()
      : previousState.remoteAttemptedAt || null,
    remoteCheckedAt: shouldCheckRemote && !checkError
      ? checkedAt.toISOString()
      : previousState.remoteCheckedAt || null,
    nextRemoteCheckAt: shouldCheckRemote
      ? new Date(checkedAt.getTime() + remoteBackoffMs(failureCount)).toISOString()
      : previousState.nextRemoteCheckAt || null,
    remoteFailureCount: failureCount,
    releaseEtag: remoteResult
      ? remoteResult.etag
      : previousState.releaseEtag || null,
    releaseVersion: remoteResult
      ? remoteResult.releaseVersion
      : previousState.releaseVersion || stagedRelease?.version || null,
    installedVersion: installed,
    availableVersion: candidate?.version || null,
    availableCodexVersion: candidate?.compatibility.codexVersion || null,
    availableCodexBuild: candidate?.compatibility.codexBuild || null,
    stagedSourceRoot: stagedRelease?.root || null,
    error: shouldCheckRemote ? checkError : previousState.error || null,
    automaticRepair,
  });
  if (repairWait) {
    appendLog(
      "info",
      `Codex ${identity.version} (${identity.build}) detected; waiting for a compatible verified Workflow release`,
    );
    if (!notifyRepairRequired()) {
      appendLog("error", "Could not show the one-time Workflow repair notification");
    }
  } else if (background && checkError && checkError !== previousState.error) {
    appendLog("error", `Workflow release check failed: ${checkError}`);
  }
  if (background && automaticRepairCandidate) {
    await applyAutomaticRepair(config, automaticRepairCandidate, identity, previousState);
    return;
  }
  if (!candidate || !apply) {
    if (background) return;
    appendLog("info", candidate ? `Workflow ${candidate.version} is available` : "No Workflow update is available");
    return;
  }
  applyCandidate(config, candidate);
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

module.exports = {
  automaticRepairDecision,
  automaticRepairWaitState,
  applyAutomaticRepair,
  checkRemote,
  compareVersions,
  compatibilityMatches,
  eligibleReleaseCandidate,
  nextAutomaticRepairState,
  notifyRepairRequired,
  releaseVersionEligible,
  remoteBackoffMs,
  remoteCheckDue,
  chooseCandidate,
  selectStagedCandidate,
  sourcePackage,
  validateTarEntries,
  validateTarTypes,
  waitForProcessExit,
};
