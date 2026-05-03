import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
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
  if (missing.length === 0) return; // already populated

  try {
    execSync(
      `git submodule update --init ${missing.map((s) => `'${s}'`).join(" ")}`,
      { cwd: rootDir, stdio: "ignore", timeout: 60_000 },
    );
  } catch {
    // Silent — submodules may fail to fetch (offline, no network, etc.)
    // Each individual plugin load will throw a clear error later.
  }
}

/**
 * Load a single plugin's default factory and call it with the pi API object.
 */
async function loadPlugin(pi, pluginName) {
  const pluginDir = join(dirname(fileURLToPath(import.meta.url)), pluginName);
  const entry = join(pluginDir, "index.js");

  if (!existsSync(entry)) {
    throw new Error(
      `${pluginName} is missing — try running "gsd update" or reinstall gsd-me with "gsd install https://github.com/PamelaSprin47685ghall/gsd-me.git"`,
    );
  }

  const mod = await import(entry);
  const factory = mod.default ?? mod;
  if (typeof factory === "function") factory(pi);
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
