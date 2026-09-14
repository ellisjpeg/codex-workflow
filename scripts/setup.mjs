import {
  appendFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import {
  appIsRunning,
  appRoot,
  sourceRoot,
} from "./lib.mjs";

const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export function approvalAccepted(value) {
  return ["y", "yes"].includes(String(value || "").trim().toLowerCase());
}

function throwIfInterrupted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Setup interrupted");
}

function appendCommandLog(logPath, label, result) {
  appendFileSync(logPath, `\n## ${label}\n${result.stdout || ""}${result.stderr || ""}`, { mode: 0o600 });
}

function runCaptured(logPath, label, command, args) {
  const result = spawnSync(command, args, {
    cwd: sourceRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  appendCommandLog(logPath, label, result);
  if (result.status !== 0) throw new Error(`${label} failed`);
  return result.stdout;
}

function runNodeJson(logPath, label, script, args = []) {
  const output = runCaptured(logPath, label, process.execPath, [join(sourceRoot, script), ...args]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid output`);
  }
}

async function askForApproval(signal, question) {
  if (!process.stdin.isTTY) {
    throw new Error("Interactive approval requires a terminal; rerun with --yes for agent mode");
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return approvalAccepted(await input.question(question, { signal }));
  } finally {
    input.close();
  }
}

async function waitForProductionExit(signal, timeoutMs = 120000) {
  if (!appIsRunning()) return;
  console.log("Quit Codex with Cmd+Q. Waiting up to two minutes…");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfInterrupted(signal);
    if (!appIsRunning()) return;
    await delay(250);
  }
  throw new Error("Codex did not quit within two minutes");
}

export async function runSetup({
  assumeYes = false,
  autoRepair = false,
  noAutoRepair = false,
  signal = null,
  logPath,
} = {}, hooks = {}) {
  const print = hooks.print || console.log;
  const status = (hooks.readStatus || (() => runNodeJson(logPath, "status", "scripts/status.mjs")))();
  if (status.recommendedAction === "none") {
    print(`Workflow ${status.installedWorkflowVersion} is already current.`);
    return { ok: true, installed: false, reason: "current" };
  }
  if (!["install", "reapply"].includes(status.recommendedAction)) {
    throw new Error(`Setup stopped safely: status recommends ${status.recommendedAction}`);
  }

  print("1/3 Checking source and guarded preflight…");
  (hooks.runChecks || (() => runCaptured(
    logPath,
    "source checks",
    process.env.npm_execpath ? process.execPath : "npm",
    process.env.npm_execpath
      ? [process.env.npm_execpath, "run", "check", "--silent"]
      : ["run", "check", "--silent"],
  )))();
  const installArgs = [
    ...(status.recommendedAction === "reapply" ? ["--reapply"] : []),
    ...(autoRepair ? ["--auto-repair"] : noAutoRepair ? ["--no-auto-repair"] : []),
  ];
  (hooks.runDryRun || (() => runNodeJson(
    logPath,
    "install preflight",
    "scripts/install.mjs",
    [...installArgs, "--dry-run"],
  )))();
  throwIfInterrupted(signal);

  if (!assumeYes && !await (hooks.askForApproval || askForApproval)(
    signal,
    status.recommendedAction === "install"
      ? "Install Workflow into Codex? This changes the app bundle and its signature. [y/N] "
      : "Reapply Workflow to Codex? This changes the app bundle and its signature. [y/N] ",
  )) {
    print("Setup cancelled; production Codex was unchanged.");
    return { ok: true, installed: false, reason: "declined" };
  }

  print("2/3 Applying the guarded installation once…");
  await (hooks.waitForProductionExit || waitForProductionExit)(signal);
  throwIfInterrupted(signal);
  (hooks.applyInstall || (() => runNodeJson(
    logPath,
    "installation",
    "scripts/install.mjs",
    installArgs,
  )))();
  const verified = (hooks.verifyStatus || (() => runNodeJson(
    logPath,
    "installed verification",
    "scripts/status.mjs",
  )))();
  if (!verified.ok || verified.pendingTransaction || !verified.patched) {
    throw new Error("Installed Workflow did not pass status verification");
  }
  const opened = (hooks.openApp || (() => spawnSync("/usr/bin/open", [appRoot], { encoding: "utf8" })))();
  if (opened?.status !== undefined && opened.status !== 0) {
    appendCommandLog(logPath, "relaunch", opened);
    throw new Error("Workflow installed, but Codex could not be relaunched");
  }
  print(`3/3 Workflow ${verified.installedWorkflowVersion} installed and Codex relaunched.`);
  return { ok: true, installed: true, autoRepairCodexUpdates: autoRepair };
}

function cliOptions() {
  const allowed = new Set(["--yes", "--auto-repair", "--no-auto-repair"]);
  const unknown = process.argv.slice(2).filter((value) => !allowed.has(value));
  if (unknown.length) throw new Error(`Unknown setup option: ${unknown[0]}`);
  const autoRepair = process.argv.includes("--auto-repair");
  const noAutoRepair = process.argv.includes("--no-auto-repair");
  if (autoRepair && noAutoRepair) throw new Error("Choose either --auto-repair or --no-auto-repair");
  return { assumeYes: process.argv.includes("--yes"), autoRepair, noAutoRepair };
}

async function main() {
  const logRoot = mkdtempSync("/private/tmp/codex-workflow-setup-");
  const logPath = join(logRoot, "setup.log");
  const controller = new AbortController();
  let interruptedSignal = null;
  const handlers = new Map(["SIGHUP", "SIGINT", "SIGTERM"].map((name) => [name, () => {
    interruptedSignal ||= name;
    controller.abort(new Error(`Setup interrupted by ${name}`));
  }]));
  for (const [name, handler] of handlers) process.once(name, handler);
  try {
    const result = await runSetup({ ...cliOptions(), signal: controller.signal, logPath });
    rmSync(logRoot, { recursive: true, force: true });
    return result;
  } catch (error) {
    appendFileSync(logPath, `\n## setup error\n${error?.stack || error}\n`, { mode: 0o600 });
    console.error(error?.message || error);
    console.error(`Details: ${logPath}`);
    process.exitCode = interruptedSignal ? 128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[interruptedSignal] : 1;
    return null;
  } finally {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
