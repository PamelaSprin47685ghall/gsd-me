import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mainSessionsBySessionId } from '../gsd-explicit-reactive/src/session-registry.js'
import { createTaskSession } from '../gsd-explicit-reactive/src/task-helpers.js'

describe('TurnOutputGate Regression', () => {
  it('should block lifecycle events but allow UI events', async () => {
    const sessionId = 'test-session-' + Date.now()
    const receivedEvents = []

    // Mock Main Session
    const mainSession = {
      _eventListeners: [
        (ev) => {
          receivedEvents.push(ev)
        },
      ],
      sessionManager: {
        getSessionId: () => sessionId,
      },
    }

    // Register in global registry
    mainSessionsBySessionId.set(sessionId, mainSession)

    // Mock Child Session
    const childSession = {
      subscribe: (cb) => {
        childSession._cb = cb
        return () => {}
      },
      // pi-agent style session structure
      isSubSession: false,
    }

    // Task Context
    const ctx = {
      sessionManager: mainSession.sessionManager,
      ui: {
        notify: () => {},
      },
    }

    const createAgentSessionFn = async () => ({ session: childSession })

    const { session, cleanup } = await createTaskSession(
      'T01',
      ctx,
      createAgentSessionFn,
    )

    // Simulate events from child session
    childSession._cb({ type: 'turn_start' })
    childSession._cb({ type: 'message', content: 'hello' })
    childSession._cb({ type: 'agent_end' }) // This should be BLOCKED
    childSession._cb({ type: 'session_shutdown' }) // This should be BLOCKED
    childSession._cb({ type: 'turn_end' })

    cleanup()

    const eventTypes = receivedEvents.map((e) => e.type)

    assert.ok(eventTypes.includes('turn_start'), 'Should allow turn_start')
    assert.ok(eventTypes.includes('message'), 'Should allow message')
    assert.ok(eventTypes.includes('turn_end'), 'Should allow turn_end')

    assert.ok(
      !eventTypes.includes('agent_end'),
      'Should BLOCK agent_end to prevent state machine collision',
    )
    assert.ok(
      !eventTypes.includes('session_shutdown'),
      'Should BLOCK session_shutdown',
    )

    // Verify tagging
    const messageEvent = receivedEvents.find((e) => e.type === 'message')
    assert.strictEqual(messageEvent._dagChildSession, true)
    assert.strictEqual(messageEvent._dagTaskId, 'T01')

    // Cleanup registry
    mainSessionsBySessionId.delete(sessionId)
  })
})
