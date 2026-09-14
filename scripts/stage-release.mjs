import { constants, copyFileSync, cpSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The updater is an installation asset, not a second copy of the development tree.
// Deferred policy modules and parked regression fixtures remain in the source checkout.
export const releaseFiles = [
  "loader.cjs", "runtime/main.cjs", "runtime/preload.cjs", "runtime/updater.cjs",
  "scripts/adhoc.entitlements", "scripts/install.mjs", "scripts/install-runtime.mjs",
  "scripts/lib.mjs", "scripts/setup.mjs", "scripts/staging.mjs",
  "scripts/staging-updater-disabled.cjs", "scripts/status.mjs", "scripts/uninstall.mjs",
  "package.json", "package-lock.json", "workflow-compatibility.json", "README.md", "SECURITY.md", "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];

// Shared by packaging and draft creation: neither may reinterpret a loose tag.
export function readReleaseMetadata(sourceRoot, version) {
  const readJson = file => JSON.parse(readFileSync(join(sourceRoot, file), "utf8"));
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const compatibility = readJson("workflow-compatibility.json");
  const match = typeof version === "string" && version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u);
  if (!match || match[0] !== version || !match.slice(1, 4).map(Number).every(Number.isSafeInteger) ||
    match[4]?.split(".").some(id => /^0\d+$/u.test(id)) ||
    [pkg.version, lock.version, lock.packages?.[""]?.version, compatibility.workflowVersion].some(v => v !== version) ||
    [pkg.name, lock.name, lock.packages?.[""]?.name].some(name => name !== "codex-workflow") ||
    lock.lockfileVersion !== 3 || compatibility.schemaVersion !== 1) {
    throw new Error("Release tag, package, lockfile and compatibility metadata must agree on a valid version");
  }
  return { version, prerelease: Boolean(match[4]), lock };
}

export function stageRelease(sourceRoot, targetRoot, version) {
  const { lock } = readReleaseMetadata(sourceRoot, version);
  const dependencies = Object.entries(lock.packages).filter(([name, pkg]) => name && !pkg.dev);
  mkdirSync(dirname(targetRoot), { recursive: true });
  mkdirSync(targetRoot); // Refuse an existing destination; never clean someone else's tree.
  try {
    for (const file of releaseFiles) {
      const source = join(sourceRoot, file);
      if (!lstatSync(source).isFile()) throw new Error(`Release source is not a regular file: ${file}`);
      const target = join(targetRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target, constants.COPYFILE_EXCL);
    }
    for (const [name, dependency] of dependencies) {
      if (!name.startsWith("node_modules/") || name.includes("\\") ||
        name.split("/").some(part => !part || part === "." || part === "..")) {
        throw new Error(`Unsafe locked dependency path: ${name}`);
      }
      const source = join(sourceRoot, name);
      if (!lstatSync(source).isDirectory() || JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version !== dependency.version) {
        throw new Error(`Installed dependency does not match the lockfile: ${name}`);
      }
      cpSync(source, join(targetRoot, name), {
        recursive: true,
        filter(file) {
          // Nested dependencies are copied from their own lockfile entries, not wholesale.
          if (relative(source, file).split(/[\\/]/u).includes("node_modules")) return false;
          const stat = lstatSync(file);
          if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Unsupported release entry: ${file}`);
          return true;
        },
      });
    }
    return { version, root: targetRoot, dependencies: dependencies.length };
  } catch (error) {
    rmSync(targetRoot, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.main) {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const version = process.argv[2];
  if (!process.argv[3]) throw new Error("Usage: stage-release.mjs <version> <new-destination>");
  console.log(JSON.stringify(stageRelease(sourceRoot, resolve(process.argv[3]), version), null, 2));
}
