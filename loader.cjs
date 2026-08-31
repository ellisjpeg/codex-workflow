"use strict";

const fs = require("node:fs");
const path = require("node:path");

const pkg = require("./package.json");
const meta = pkg.__codexWorkflow || {};
const originalMain = meta.originalMain;
const runtimeRoot = meta.runtimeRoot;

function log(message) {
  try {
    const logDir = path.join(runtimeRoot, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "loader.log"),
      `[${new Date().toISOString()}] ${message}\n`,
    );
  } catch {}
}

try {
  if (!originalMain || !runtimeRoot) {
    throw new Error("missing __codexWorkflow metadata");
  }
  process.env.CODEX_WORKFLOW_ROOT = runtimeRoot;
  require(path.join(runtimeRoot, "runtime", "main.cjs"));
} catch (error) {
  log(`runtime failed: ${error?.stack || error}`);
}

if (!originalMain) {
  throw new Error("Codex Workflow loader cannot resolve the original app entry point");
}

require(path.resolve(__dirname, originalMain));
