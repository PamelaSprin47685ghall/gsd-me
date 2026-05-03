import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ── Submodules that this meta-plugin manages ──
const PLUGIN_SUBMODULES = [
  "gsd-agent-loop",
  "gsd-explicit-reactive",
  "gsd-guardian",
  "gsd-magic-todo",
  "gsd-system-prompt",
];

/**
 * Ensure submodule directories are populated.
 * gsd install does NOT pass --recursive, so submodules are empty at clone time.
 * This runs once on first load.
 */
function initSubmodules(rootDir) {
  const missing = PLUGIN_SUBMODULES.filter(
    (name) => !existsSync(join(rootDir, name, "index.js")),
  );
  if (missing.length === 0) return;

  console.log(`[gsd-me] Initializing ${missing.length} submodule(s): ${missing.join(", ")}`);

  const result = spawnSync(
    "git",
    ["submodule", "update", "--init", ...missing],
    { cwd: rootDir, stdio: "inherit", timeout: 60_000 },
  );

  if (result.error) {
    throw new Error(
      `[gsd-me] Failed to initialize submodules: ${result.error.message}\n` +
      `Try running: cd ${rootDir} && git submodule update --init --recursive`
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `[gsd-me] git submodule update failed with exit code ${result.status}\n` +
      `Try running: cd ${rootDir} && git submodule update --init --recursive`
    );
  }

  // Verify all submodules are now present
  const stillMissing = PLUGIN_SUBMODULES.filter(
    (name) => !existsSync(join(rootDir, name, "index.js")),
  );
  if (stillMissing.length > 0) {
    throw new Error(
      `[gsd-me] Submodules still missing after init: ${stillMissing.join(", ")}\n` +
      `Try running: cd ${rootDir} && git submodule update --init --recursive`
    );
  }

  console.log(`[gsd-me] ✓ All submodules initialized successfully`);
}

/**
 * Load a single plugin's default factory and call it with the pi API object.
 */
async function loadPlugin(pi, pluginName) {
  const pluginDir = join(dirname(fileURLToPath(import.meta.url)), pluginName);
  const entry = join(pluginDir, "index.js");

  if (!existsSync(entry)) {
    throw new Error(
      `${pluginName} is missing — try running "gsd update" or reinstall gsd-me`,
    );
  }

  const mod = await import(entry);
  const factory = mod.default ?? mod;
  if (typeof factory === "function") await factory(pi);
}

export default async function gsdMe(pi) {
  const rootDir = dirname(fileURLToPath(import.meta.url));

  // 1. Populate submodules on first load
  initSubmodules(rootDir);

  // 2. Load all 5 plugins
  for (const name of PLUGIN_SUBMODULES) {
    await loadPlugin(pi, name);
  }
}
