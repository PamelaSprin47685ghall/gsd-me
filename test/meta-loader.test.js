import assert from 'node:assert/strict'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import gsdMe from '../index.js'

function createMetaHarness() {
  const tools = new Map()
  const commands = new Map()
  const handlers = new Map()
  const shortcuts = new Map()

  const pi = {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    registerTool(tool) {
      tools.set(tool.name, tool)
    },
    registerCommand(name, config) {
      commands.set(name, config)
    },
    registerShortcut(shortcut, config) {
      shortcuts.set(shortcut, config)
    },
    getActiveTools() {
      return [...tools.keys()]
    },
    exec(_cmd, _args, _opts) {},
    ui: { notify() {} },
  }

  return { pi, tools, commands, handlers, shortcuts }
}

describe('gsd-me meta-plugin', () => {
  it('loads all plugin factories without error', async () => {
    const harness = createMetaHarness()

    await gsdMe(harness.pi)

    // Verify tools from tool-registering plugins
    assert.ok(harness.tools.has('loop_control'), 'agent-loop: loop_control')
    assert.ok(
      harness.tools.has('manage_todo_list'),
      'magic-todo: manage_todo_list',
    )
    assert.ok(
      harness.tools.has('_wait_for_dag_completion'),
      'explicit-reactive: _wait_for_dag_completion',
    )
    assert.ok(harness.tools.has('web_search'), 'web-search: web_search')
    assert.ok(harness.tools.has('web_fetch'), 'web-search: web_fetch')
    // Guardian and system-prompt only register event hooks, not tools

    // Verify commands from agent-loop
    assert.ok(harness.commands.has('loop'), 'agent-loop: loop command')
    assert.ok(
      harness.commands.has('loop-stop'),
      'agent-loop: loop-stop command',
    )
  })

  it('loads all plugins idempotently — second call is no-op', async () => {
    const harness = createMetaHarness()

    await gsdMe(harness.pi)
    const initialToolsSize = harness.tools.size
    const initialCommandsSize = harness.commands.size

    await gsdMe(harness.pi)

    // No duplicate tools
    assert.equal(harness.tools.size, initialToolsSize)
    // No duplicate commands
    assert.equal(harness.commands.size, initialCommandsSize)
  })

  it('registers hook handlers for all 5 plugins', async () => {
    const harness = createMetaHarness()

    await gsdMe(harness.pi)

    // Each plugin registers specific hooks
    const registeredEvents = new Set([...harness.handlers.keys()])
    // System-prompt: before_agent_start
    assert.ok(
      registeredEvents.has('before_agent_start'),
      'before_agent_start hook',
    )
    // Agent-loop: session_start, context (via tools)
    assert.ok(registeredEvents.has('context'), 'context hook')
    // Various: session_start, notification, etc.
    assert.ok(registeredEvents.has('session_start'), 'session_start hook')
    // Guardian: notification
    assert.ok(registeredEvents.has('notification'), 'notification hook')
  })

  it('loads plugins when installation path contains URL-reserved characters', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'gsd-me-#-'))

    try {
      copyFileSync(
        new URL('../index.js', import.meta.url),
        join(tempRoot, 'index.js'),
      )

      const fixtureModules = {
        'gsd-agent-loop':
          "export default async function plugin(pi) { pi.registerTool({ name: 'loop_control' }); pi.registerCommand('loop', {}); pi.registerCommand('loop-stop', {}); pi.on('context', () => {}); pi.on('session_start', () => {}); }\n",
        'gsd-explicit-reactive':
          "export default async function plugin(pi) { pi.registerTool({ name: '_wait_for_dag_completion' }); }\n",
        'gsd-guardian':
          "export default function plugin(pi) { pi.on('notification', () => {}); }\n",
        'gsd-magic-todo':
          "export default function plugin(pi) { pi.registerTool({ name: 'manage_todo_list' }); }\n",
        'gsd-system-prompt':
          "export default function plugin(pi) { pi.on('before_agent_start', () => {}); }\n",
        'gsd-web-search':
          "export default function plugin(pi) { pi.registerTool({ name: 'web_search' }); pi.registerTool({ name: 'web_fetch' }); pi.registerCommand('ollama-key', {}); }\n",
      }

      for (const [pluginName, source] of Object.entries(fixtureModules)) {
        const pluginDirectory = join(tempRoot, pluginName)
        mkdirSync(pluginDirectory, { recursive: true })
        writeFileSync(join(pluginDirectory, 'index.js'), source)
      }

      const fixtureModule = await import(
        pathToFileURL(join(tempRoot, 'index.js')).href
      )
      const harness = createMetaHarness()
      await fixtureModule.default(harness.pi)

      assert.ok(harness.tools.has('loop_control'))
      assert.ok(harness.tools.has('manage_todo_list'))
      assert.ok(harness.tools.has('_wait_for_dag_completion'))
      assert.ok(harness.tools.has('web_search'))
      assert.ok(harness.tools.has('web_fetch'))
      assert.ok(harness.commands.has('loop'))
      assert.ok(harness.commands.has('loop-stop'))
      assert.ok(harness.handlers.has('before_agent_start'))
      assert.ok(harness.handlers.has('notification'))
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('initializes missing submodules with non-interactive git prompts disabled', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'gsd-me-submodule-init-'))
    const fakeGitBinDir = join(tempRoot, 'bin')
    const fakeGit = join(fakeGitBinDir, 'git')
    const gitPromptLog = join(tempRoot, 'git-prompt.log')

    const previousPath = process.env.PATH
    const previousGitPrompt = process.env.GIT_TERMINAL_PROMPT
    const previousFixtureRoot = process.env.GSD_ME_TEST_ROOT
    const previousFixturePromptLog = process.env.GSD_ME_TEST_PROMPT_LOG

    try {
      copyFileSync(
        new URL('../index.js', import.meta.url),
        join(tempRoot, 'index.js'),
      )
      mkdirSync(fakeGitBinDir, { recursive: true })

      writeFileSync(
        fakeGit,
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s' "\${GIT_TERMINAL_PROMPT:-}" > "\${GSD_ME_TEST_PROMPT_LOG}"

mkdir -p "\${GSD_ME_TEST_ROOT}/gsd-agent-loop"
cat <<'EOF' > "\${GSD_ME_TEST_ROOT}/gsd-agent-loop/index.js"
export default async function plugin(pi) { pi.registerTool({ name: 'loop_control' }); pi.registerCommand('loop', {}); pi.registerCommand('loop-stop', {}); pi.on('context', () => {}); pi.on('session_start', () => {}); }
EOF

mkdir -p "\${GSD_ME_TEST_ROOT}/gsd-explicit-reactive"
cat <<'EOF' > "\${GSD_ME_TEST_ROOT}/gsd-explicit-reactive/index.js"
export default async function plugin(pi) { pi.registerTool({ name: '_wait_for_dag_completion' }); }
EOF

mkdir -p "\${GSD_ME_TEST_ROOT}/gsd-guardian"
cat <<'EOF' > "\${GSD_ME_TEST_ROOT}/gsd-guardian/index.js"
export default function plugin(pi) { pi.on('notification', () => {}); }
EOF

mkdir -p "\${GSD_ME_TEST_ROOT}/gsd-magic-todo"
cat <<'EOF' > "\${GSD_ME_TEST_ROOT}/gsd-magic-todo/index.js"
export default function plugin(pi) { pi.registerTool({ name: 'manage_todo_list' }); }
EOF

mkdir -p "\${GSD_ME_TEST_ROOT}/gsd-system-prompt"
cat <<'EOF' > "\${GSD_ME_TEST_ROOT}/gsd-system-prompt/index.js"
export default function plugin(pi) { pi.on('before_agent_start', () => {}); }
EOF

mkdir -p "\${GSD_ME_TEST_ROOT}/gsd-web-search"
cat <<'EOF' > "\${GSD_ME_TEST_ROOT}/gsd-web-search/index.js"
export default function plugin(pi) { pi.registerTool({ name: 'web_search' }); pi.registerTool({ name: 'web_fetch' }); pi.registerCommand('ollama-key', {}); }
EOF
`,
      )
      chmodSync(fakeGit, 0o755)

      process.env.PATH = `${fakeGitBinDir}:${previousPath ?? ''}`
      process.env.GIT_TERMINAL_PROMPT = '1'
      process.env.GSD_ME_TEST_ROOT = tempRoot
      process.env.GSD_ME_TEST_PROMPT_LOG = gitPromptLog

      const fixtureModule = await import(
        pathToFileURL(join(tempRoot, 'index.js')).href
      )
      const harness = createMetaHarness()
      await fixtureModule.default(harness.pi)

      assert.equal(readFileSync(gitPromptLog, 'utf-8'), '0')
      assert.ok(harness.tools.has('loop_control'))
      assert.ok(harness.tools.has('manage_todo_list'))
      assert.ok(harness.tools.has('_wait_for_dag_completion'))
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath

      if (previousGitPrompt === undefined)
        delete process.env.GIT_TERMINAL_PROMPT
      else process.env.GIT_TERMINAL_PROMPT = previousGitPrompt

      if (previousFixtureRoot === undefined) delete process.env.GSD_ME_TEST_ROOT
      else process.env.GSD_ME_TEST_ROOT = previousFixtureRoot

      if (previousFixturePromptLog === undefined)
        delete process.env.GSD_ME_TEST_PROMPT_LOG
      else process.env.GSD_ME_TEST_PROMPT_LOG = previousFixturePromptLog

      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
