import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseMetadata } from "./stage-release.mjs";

// Command construction lets tests exercise the publication policy without
// contacting GitHub. There is deliberately no publish/edit/delete operation.
export function releaseDraftArguments(sourceRoot, tag, archivePath) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error("Release tag must start with v and match source metadata");
  }
  const { version, prerelease } = readReleaseMetadata(sourceRoot, tag.slice(1));
  if (typeof archivePath !== "string" || basename(archivePath) !== `codex-workflow-${version}.tar.gz`) {
    throw new Error("Release asset filename must match the validated version");
  }
  const archive = resolve(archivePath);
  const notes = join(resolve(sourceRoot), "docs", "releases", `${version}.md`);
  for (const file of [archive, notes]) {
    if (!lstatSync(file).isFile()) throw new Error(`Release input is not a regular file: ${file}`);
  }
  return [
    "release", "create", tag, archive,
    "--draft", "--latest=false", "--verify-tag",
    "--title", `Workflow ${version}`,
    "--notes-file", notes,
    ...(prerelease ? ["--prerelease"] : []),
  ];
}

// Available before our minimum Node 24.15.0; handles aliases and stdin imports.
if (import.meta.main) {
  const [tag, archive, ...extra] = process.argv.slice(2);
  if (!tag || !archive || extra.length) throw new Error("Usage: release-draft.mjs <v-version> <archive>");
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = releaseDraftArguments(sourceRoot, tag, archive);
  const result = spawnSync("gh", args, { cwd: sourceRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Release draft command terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
}
