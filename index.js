import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PLUGIN_SUBMODULES = [
  'gsd-advisor',
  'gsd-agent-loop',
  'gsd-explicit-reactive',
  'gsd-fff',
  'gsd-guardian',
  'gsd-magic-todo',
  'gsd-syntax',
  'gsd-system-prompt',
  'gsd-web-search',
]

/**
 * Ensure submodule directories are populated.
 * gsd install does NOT pass --recursive, so submodules are empty at clone time.
 * This runs once on first load.
 */
function initSubmodules(rootDir) {
  const missing = PLUGIN_SUBMODULES.filter(
    (name) => !existsSync(join(rootDir, name, 'index.js')),
  )
  if (missing.length === 0) return

  console.log(
    `[gsd-me] Initializing ${missing.length} submodule(s): ${missing.join(', ')}`,
  )

  const result = spawnSync(
    'git',
    ['submodule', 'update', '--init', ...missing],
    {
      cwd: rootDir,
      stdio: 'pipe',
      timeout: 60_000,
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  )

  if (result.error) {
    console.warn(
      `[gsd-me] Failed to initialize submodules: ${result.error.message}`,
    )
    return
  }

  if (result.status != null && result.status !== 0) {
    const stderr = result.stderr?.trim() || ''
    console.warn(
      `[gsd-me] git submodule update failed with exit code ${result.status}${stderr ? `\n${stderr}` : ''}`,
    )
    return
  }

  if (result.stdout) {
    console.log(result.stdout.trim())
  }

  // Verify all submodules are now present
  const stillMissing = PLUGIN_SUBMODULES.filter(
    (name) => !existsSync(join(rootDir, name, 'index.js')),
  )
  if (stillMissing.length > 0) {
    console.warn(
      `[gsd-me] Submodules still missing after init: ${stillMissing.join(', ')}`,
    )
  } else {
    console.log(`[gsd-me] ✓ All submodules initialized successfully`)
  }
}

/**
 * Load a single plugin's default factory and call it with the pi API object.
 */
async function loadPlugin(pi, pluginName) {
  const pluginDir = join(dirname(fileURLToPath(import.meta.url)), pluginName)
  const entry = join(pluginDir, 'index.js')

  if (!existsSync(entry)) {
    throw new Error(
      `${pluginName} is missing — try running "gsd update" or reinstall gsd-me`,
    )
  }

  const mod = await import(pathToFileURL(entry).href)
  const factory = mod.default ?? mod
  if (typeof factory === 'function') await factory(pi)
}

export default async function gsdMe(pi) {
  const rootDir = dirname(fileURLToPath(import.meta.url))

  // 1. Populate submodules on first load
  initSubmodules(rootDir)

  // 2. Load all plugins
  for (const name of PLUGIN_SUBMODULES) {
    try {
      await loadPlugin(pi, name)
    } catch (err) {
      console.warn(`[gsd-me] Failed to load plugin ${name}: ${err.message}`)
    }
  }
}
