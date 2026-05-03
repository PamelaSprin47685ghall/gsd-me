import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const plugins = [
  {
    dir: "gsd-agent-loop",
    manifest: {
      id: "agent-loop",
      tools: ["loop_control"],
      commands: ["loop", "loop-stop"],
      hooks: ["session_start", "session_switch", "session_fork", "session_tree", "before_agent_start"],
      shortcuts: ["Ctrl+Shift+X"],
    },
  },
  {
    dir: "gsd-explicit-reactive",
    manifest: {
      id: "explicit-reactive",
      tools: ["_wait_for_dag_completion"],
      hooks: ["session_start", "session_shutdown"],
    },
  },
  {
    dir: "gsd-guardian",
    manifest: {
      id: "guardian",
      hooks: ["agent_end", "notification", "session_before_switch", "session_start", "before_agent_start", "stop"],
    },
  },
  {
    dir: "gsd-magic-todo",
    manifest: {
      id: "magic-todo",
      tools: ["manage_todo_list"],
      hooks: ["session_start", "session_switch", "session_fork", "session_tree", "context", "session_before_compact"],
    },
  },
  {
    dir: "gsd-system-prompt",
    manifest: {
      id: "system-prompt",
      hooks: ["before_agent_start", "before_provider_request"],
    },
  },
];

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sorted = value => [...(value || [])].sort();

describe("plugin package and manifest consistency", () => {
  test("all plugins share the suite version and install entry style", () => {
    const versions = new Set();

    for (const plugin of plugins) {
      const packageJson = readJson(path.join(plugin.dir, "package.json"));
      const manifest = readJson(path.join(plugin.dir, "extension-manifest.json"));

      versions.add(packageJson.version);
      versions.add(manifest.version);
      assert.equal(packageJson.type, "module");
      assert.equal(packageJson.exports, "./index.js");
      assert.deepEqual(packageJson.pi?.extensions, ["./index.js"]);
      assert.equal(packageJson.gsd?.extension, true);
      assert.equal(manifest.tier, "community");
      assert.deepEqual(manifest.requires, { platform: ">=2.29.0" });
    }

    assert.deepEqual([...versions], ["5.1.0"]);
  });

  test("manifests declare the actual public extension surface", () => {
    for (const plugin of plugins) {
      const manifest = readJson(path.join(plugin.dir, "extension-manifest.json"));
      assert.equal(manifest.id, plugin.manifest.id);
      assert.deepEqual(sorted(manifest.provides?.tools), sorted(plugin.manifest.tools));
      assert.deepEqual(sorted(manifest.provides?.commands), sorted(plugin.manifest.commands));
      assert.deepEqual(sorted(manifest.provides?.hooks), sorted(plugin.manifest.hooks));
      assert.deepEqual(sorted(manifest.provides?.shortcuts), sorted(plugin.manifest.shortcuts));
    }
  });
});
