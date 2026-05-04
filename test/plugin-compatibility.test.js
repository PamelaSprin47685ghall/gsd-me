import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import agentLoopPlugin from '../gsd-agent-loop/index.js'
import explicitReactivePlugin from '../gsd-explicit-reactive/index.js'
import guardianPlugin from '../gsd-guardian/index.js'
import magicTodoPlugin from '../gsd-magic-todo/index.js'
import systemPromptPlugin from '../gsd-system-prompt/index.js'
import { shouldRecoverFromNotification } from '../gsd-guardian/src/notification-listener.js'

const createPluginHarness = ({ strictRegistration = false } = {}) => {
  const handlers = new Map()
  const tools = new Map()
  const commands = new Map()
  const shortcuts = new Map()
  const notifications = []
  const userMessages = []
  const customMessages = []

  const pi = {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    registerTool(tool) {
      if (strictRegistration && tools.has(tool.name))
        throw new Error(`duplicate tool ${tool.name}`)
      tools.set(tool.name, tool)
    },
    registerCommand(name, config) {
      if (strictRegistration && commands.has(name))
        throw new Error(`duplicate command ${name}`)
      commands.set(name, config)
    },
    registerShortcut(shortcut, config) {
      if (strictRegistration && shortcuts.has(shortcut))
        throw new Error(`duplicate shortcut ${shortcut}`)
      shortcuts.set(shortcut, config)
    },
    sendUserMessage(content) {
      userMessages.push(content)
    },
    sendMessage(message) {
      customMessages.push(message)
    },
    getActiveTools() {
      return [...tools.keys()]
    },
    ui: {
      notify(message, level = 'info') {
        notifications.push({ message, level })
      },
    },
  }

  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    ui: pi.ui,
    abort() {},
    sessionManager: {
      getBranch: () => [],
      getSessionId: () => 'compat-session',
    },
  }

  const emitBeforeAgentStart = async (systemPrompt) => {
    let event = { prompt: 'test', systemPrompt }
    for (const handler of handlers.get('before_agent_start') ?? []) {
      const result = await handler(event, ctx)
      if (result?.systemPrompt !== undefined) {
        event = { ...event, systemPrompt: result.systemPrompt }
      }
    }
    return event.systemPrompt
  }

  const emitContext = async (messages) => {
    let event = { messages }
    for (const handler of handlers.get('context') ?? []) {
      const result = await handler(event, ctx)
      if (Array.isArray(result?.messages)) {
        event = { ...event, messages: result.messages }
      }
    }
    return event.messages
  }

  return {
    pi,
    ctx,
    handlers,
    tools,
    commands,
    shortcuts,
    notifications,
    userMessages,
    customMessages,
    emitBeforeAgentStart,
    emitContext,
  }
}

const createFailOnce = (
  implementation,
  message = 'transient initialization failure',
) => {
  let shouldFail = true
  return (...args) => {
    if (shouldFail) {
      shouldFail = false
      throw new Error(message)
    }
    return implementation(...args)
  }
}

describe('all bundled plugins compatibility', () => {
  it('loads all plugins and preserves independent tool/command surfaces', async () => {
    const harness = createPluginHarness()

    await agentLoopPlugin(harness.pi)
    await explicitReactivePlugin(harness.pi)
    guardianPlugin(harness.pi)
    magicTodoPlugin(harness.pi)
    systemPromptPlugin(harness.pi)

    assert.ok(harness.tools.has('loop_control'))
    assert.ok(harness.tools.has('manage_todo_list'))
    assert.ok(harness.tools.has('_wait_for_dag_completion'))
    assert.ok(harness.commands.has('loop'))
    assert.ok(harness.commands.has('loop-stop'))

    const systemPrompt = await harness.emitBeforeAgentStart(
      [
        'Keep this.',
        '## Codebase Map',
        'large generated map',
        '## GSD Skill Preferences',
        '- stable preference',
      ].join('\n'),
    )

    assert.match(systemPrompt, /Keep this\./)
    assert.doesNotMatch(systemPrompt, /large generated map/)
    assert.match(systemPrompt, /stable preference/)

    const messages = await harness.emitContext([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ])
    assert.equal(messages.length, 2)
  })

  it('does not let Guardian recover from benign sibling plugin notifications', async () => {
    const harness = createPluginHarness()
    guardianPlugin(harness.pi)

    for (const handler of harness.handlers.get('notification') ?? []) {
      await handler(
        {
          severity: 'warning',
          message:
            'magic-todo: session_start restored 0 todos and 0 backlog reports.',
          id: 'n1',
        },
        harness.ctx,
      )
      await handler(
        {
          severity: 'warning',
          message: 'pruner: HINTS 加载警告 — missing file',
          id: 'n2',
        },
        harness.ctx,
      )
      await handler(
        {
          severity: 'warning',
          message: '[dag] M001/S01 {"event":"tick"}',
          id: 'n3',
        },
        harness.ctx,
      )
    }

    assert.equal(harness.userMessages.length, 0)
  })

  it('keeps plugin registration and hooks idempotent when discovered twice', async () => {
    const harness = createPluginHarness({ strictRegistration: true })

    await agentLoopPlugin(harness.pi)
    await explicitReactivePlugin(harness.pi)
    guardianPlugin(harness.pi)
    magicTodoPlugin(harness.pi)
    systemPromptPlugin(harness.pi)

    const hookCounts = new Map(
      [...harness.handlers].map(([name, callbacks]) => [
        name,
        callbacks.length,
      ]),
    )

    await agentLoopPlugin(harness.pi)
    await explicitReactivePlugin(harness.pi)
    guardianPlugin(harness.pi)
    magicTodoPlugin(harness.pi)
    systemPromptPlugin(harness.pi)

    assert.deepEqual(
      new Map(
        [...harness.handlers].map(([name, callbacks]) => [
          name,
          callbacks.length,
        ]),
      ),
      hookCounts,
    )
    assert.equal(harness.tools.size, 3)
    assert.equal(harness.commands.size, 2)
  })

  it('recovers from one-time initialization failures across all plugins', async () => {
    {
      const tools = new Map()
      const commands = new Map()
      const pi = {
        on: () => {},
        registerTool: createFailOnce(
          (tool) => tools.set(tool.name, tool),
          'agent-loop transient',
        ),
        registerCommand: (name, config) => commands.set(name, config),
        registerShortcut: () => {},
        sendUserMessage: () => {},
      }

      await assert.rejects(() => agentLoopPlugin(pi), /agent-loop transient/)
      await assert.doesNotReject(() => agentLoopPlugin(pi))
      assert.ok(tools.has('loop_control'))
      assert.ok(commands.has('loop'))
      assert.ok(commands.has('loop-stop'))
    }

    {
      const tools = new Map()
      const pi = {
        on: () => {},
        registerTool: createFailOnce(
          (tool) => tools.set(tool.name, tool),
          'explicit-reactive transient',
        ),
      }

      await assert.rejects(
        () => explicitReactivePlugin(pi),
        /explicit-reactive transient/,
      )
      await assert.doesNotReject(() => explicitReactivePlugin(pi))
      assert.ok(tools.has('_wait_for_dag_completion'))
    }

    {
      const handlers = new Map()
      const pi = {
        on: createFailOnce((event, handler) => {
          handlers.set(event, [...(handlers.get(event) ?? []), handler])
        }, 'guardian transient'),
      }

      assert.throws(() => guardianPlugin(pi), /guardian transient/)
      assert.doesNotThrow(() => guardianPlugin(pi))
      assert.ok(handlers.has('agent_end'))
      assert.ok(handlers.has('stop'))
    }

    {
      const handlers = new Map()
      const tools = new Map()
      const pi = {
        on: createFailOnce((event, handler) => {
          handlers.set(event, [...(handlers.get(event) ?? []), handler])
        }, 'magic-todo transient'),
        registerTool: (tool) => tools.set(tool.name, tool),
      }

      assert.throws(() => magicTodoPlugin(pi), /magic-todo transient/)
      assert.doesNotThrow(() => magicTodoPlugin(pi))
      assert.ok(handlers.has('context'))
      assert.ok(tools.has('manage_todo_list'))
    }

    {
      const handlers = new Map()
      const pi = {
        on: createFailOnce((event, handler) => {
          handlers.set(event, [...(handlers.get(event) ?? []), handler])
        }, 'system-prompt transient'),
      }

      assert.throws(() => systemPromptPlugin(pi), /system-prompt transient/)
      assert.doesNotThrow(() => systemPromptPlugin(pi))
      assert.ok(handlers.has('before_agent_start'))
      assert.ok(handlers.has('before_provider_request'))
    }
  })

  it('lets Guardian recover from critical DAG notifications', () => {
    const recoverableDagMessages = [
      '[DAG] Task T01 error: missing gsd_task_complete tool — FAILED',
      '[DAG] CRITICAL: failed to write REPLAN-TRIGGER — slice replan will not be triggered automatically: EACCES',
    ]

    for (const message of recoverableDagMessages) {
      assert.equal(
        shouldRecoverFromNotification(
          { severity: 'warning', message },
          message,
        ),
        true,
        message,
      )
    }
  })
})
