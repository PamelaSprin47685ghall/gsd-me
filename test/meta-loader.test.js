import assert from "node:assert/strict";
import { describe, it } from "node:test";
import gsdMe from "../index.js";

function createMetaHarness() {
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const shortcuts = new Map();

  const pi = {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerCommand(name, config) {
      commands.set(name, config);
    },
    registerShortcut(shortcut, config) {
      shortcuts.set(shortcut, config);
    },
    getActiveTools() {
      return [...tools.keys()];
    },
    exec(_cmd, _args, _opts) {},
    ui: { notify() {} },
  };

  return { pi, tools, commands, handlers, shortcuts };
}

describe("gsd-me meta-plugin", () => {
  it("loads all 5 plugin factories without error", async () => {
    const harness = createMetaHarness();

    await gsdMe(harness.pi);

    // Verify tools from tool-registering plugins
    assert.ok(harness.tools.has("loop_control"), "agent-loop: loop_control");
    assert.ok(harness.tools.has("manage_todo_list"), "magic-todo: manage_todo_list");
    assert.ok(harness.tools.has("_wait_for_dag_completion"), "explicit-reactive: _wait_for_dag_completion");
    // Guardian and system-prompt only register event hooks, not tools

    // Verify commands from agent-loop
    assert.ok(harness.commands.has("loop"), "agent-loop: loop command");
    assert.ok(harness.commands.has("loop-stop"), "agent-loop: loop-stop command");
  });

  it("loads all plugins idempotently — second call is no-op", async () => {
    const harness = createMetaHarness();

    await gsdMe(harness.pi);
    await gsdMe(harness.pi);

    // No duplicate tools
    assert.equal(harness.tools.size, 3);
    // No duplicate commands
    assert.equal(harness.commands.size, 2);
  });

  it("registers hook handlers for all 5 plugins", async () => {
    const harness = createMetaHarness();

    await gsdMe(harness.pi);

    // Each plugin registers specific hooks
    const registeredEvents = new Set([...harness.handlers.keys()]);
    // System-prompt: before_agent_start
    assert.ok(registeredEvents.has("before_agent_start"), "before_agent_start hook");
    // Agent-loop: session_start, context (via tools)
    assert.ok(registeredEvents.has("context"), "context hook");
    // Various: session_start, notification, etc.
    assert.ok(registeredEvents.has("session_start"), "session_start hook");
    // Guardian: notification
    assert.ok(registeredEvents.has("notification"), "notification hook");
  });
});
