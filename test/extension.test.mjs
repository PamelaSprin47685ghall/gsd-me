// ==============================================================================
// Tests for index.js — extension registration and tool wiring
// ==============================================================================
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ==============================================================================
// Mock pi API
// ==============================================================================

/**
 * Create a mock pi API object that records calls for assertion.
 *
 * @returns {{ pi: object, calls: { on: Array, registerTool: Array } }}
 */
function createMockPi() {
  /** @type {Array<[string, Function]>} */
  const onCalls = [];

  /** @type {Array<object>} */
  const registerToolCalls = [];

  const pi = {
    on(event, handler) {
      onCalls.push([event, handler]);
    },
    registerTool(toolDef) {
      registerToolCalls.push(toolDef);
    },
  };

  return {
    pi,
    calls: {
      on: onCalls,
      registerTool: registerToolCalls,
    },
  };
}

// ==============================================================================
// Extension loading and structure
// ==============================================================================
describe("extension registration", () => {
  it("loads the extension module without error", async () => {
    // Dynamic import should resolve without throwing
    const mod = await import("../index.js");
    assert(mod.default !== undefined, "Module must have a default export");
    assert.strictEqual(typeof mod.default, "function", "Default export must be a function");
  });

  it("calls pi.registerTool with correct tool name", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    assert.strictEqual(calls.registerTool.length, 1, "Must call registerTool exactly once");
    const toolDef = calls.registerTool[0];
    assert.strictEqual(toolDef.name, "read", "Tool must be named 'read'");
  });

  it("registers read tool with all required fields", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const toolDef = calls.registerTool[0];
    assert(toolDef.label !== undefined, "Tool must have a label");
    assert(toolDef.description !== undefined, "Tool must have a description");
    assert(toolDef.parameters !== undefined, "Tool must have parameters JSON schema");
    assert.strictEqual(typeof toolDef.execute, "function", "Tool must have an execute function");
    assert(Array.isArray(toolDef.promptGuidelines), "Tool must have promptGuidelines array");
  });

  it("registers tool_call signal handler", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const toolCallHandlers = calls.on.filter(([event]) => event === "tool_call");
    assert.strictEqual(toolCallHandlers.length, 1, "Must register one tool_call handler");
    assert.strictEqual(typeof toolCallHandlers[0][1], "function", "Handler must be a function");
  });
});

// ==============================================================================
// Tool parameter schema validation
// ==============================================================================
describe("tool parameter schema", () => {
  it("accepts path as required field", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const schema = calls.registerTool[0].parameters;
    assert(schema.properties !== undefined, "Schema must have properties");
    assert(
      schema.properties.path !== undefined,
      'Schema must define "path" property',
    );
    assert.strictEqual(schema.properties.path.type, "string");
  });

  it("accepts offset and limit as optional numeric fields", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const schema = calls.registerTool[0].parameters;
    assert.strictEqual(schema.properties.offset.type, "number");
    assert.strictEqual(schema.properties.limit.type, "number");
  });

  it("accepts ranges as optional array of strings", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const schema = calls.registerTool[0].parameters;
    assert(schema.properties.ranges !== undefined, 'Schema must define "ranges" property');
    assert.strictEqual(schema.properties.ranges.type, "array");
    assert.strictEqual(schema.properties.ranges.items.type, "string");
  });

  it("accepts file_paths as optional array of strings", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const schema = calls.registerTool[0].parameters;
    assert(schema.properties.file_paths !== undefined, 'Schema must define "file_paths" property');
    assert.strictEqual(schema.properties.file_paths.type, "array");
    assert.strictEqual(schema.properties.file_paths.items.type, "string");
  });

  it("has oneOf constraint for path or file_paths", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const schema = calls.registerTool[0].parameters;
    assert(Array.isArray(schema.oneOf), "Schema must have oneOf for mutual exclusivity");
    const requiredSets = schema.oneOf.map((o) => o.required);
    assert(
      requiredSets.some((r) => Array.isArray(r) && r.includes("path")),
      'oneOf must include { required: ["path"] }',
    );
    assert(
      requiredSets.some((r) => Array.isArray(r) && r.includes("file_paths")),
      'oneOf must include { required: ["file_paths"] }',
    );
  });
});

// ==============================================================================
// tool_call handler behavior
// ==============================================================================
describe("tool_call handler", () => {
  it("sets path to empty string when path is undefined on read calls", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const handler = calls.on.find(([event]) => event === "tool_call")[1];

    const event = {
      toolName: "read",
      input: { file_paths: ["src/test.ts:10-20"] },
    };
    handler(event);

    assert.strictEqual(event.input.path, "", "path should be set to empty string");
  });

  it("does not modify path when path is already a string", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const handler = calls.on.find(([event]) => event === "tool_call")[1];

    const event = {
      toolName: "read",
      input: { path: "test.txt" },
    };
    handler(event);

    assert.strictEqual(event.input.path, "test.txt", "path should remain unchanged");
  });

  it("does not modify events for other tools", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");

    mod.default(pi);

    const handler = calls.on.find(([event]) => event === "tool_call")[1];

    const event = {
      toolName: "edit",
      input: { path: undefined, multi: [] },
    };
    handler(event);

    // edit tool should not be affected by our handler
    assert.strictEqual(event.input.path, undefined, "non-read tool should not be modified");
  });
});

// ==============================================================================
// Execute function — integration with handleRead
// ==============================================================================
describe("execute function — single-file reads", () => {
  /** @type {string} */
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "gsd-ext-test-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Write content to a file in the temp directory.
   * @param {string} name
   * @param {string | Buffer} content
   * @returns {string}
   */
  function writeTmp(name, content) {
    writeFileSync(join(tmpDir, name), content);
    return name;
  }

  it("executes basic read with path parameter", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("hello.txt", "line one\nline two\nline three\n");
    const execute = calls.registerTool[0].execute;

    const result = await execute("call-1", { path: "hello.txt" }, null, null, { cwd: tmpDir });
    assert(!result.isError, `Unexpected error: ${result.content[0].text}`);
    assert(result.content[0].text.includes("line one"), "Output should contain file content");
    assert(result.content[0].text.includes("line two"), "Output should contain file content");
    assert(result.content[0].text.includes("line three"), "Output should contain file content");
  });

  it("executes read with offset/limit (GSD compatibility)", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("offset.txt", "line one\nline two\nline three\nline four\nline five\n");
    const execute = calls.registerTool[0].execute;

    // offset=2, limit=2 should read lines 2-3
    const result = await execute("call-2", { path: "offset.txt", offset: 2, limit: 2 }, null, null, { cwd: tmpDir });
    assert(!result.isError, `Unexpected error: ${result.content[0].text}`);

    // Expanded range [1,4] includes boundary context + lines 2-3
    const text = result.content[0].text;
    assert(text.includes("line two"), "Should contain line 2");
    assert(text.includes("line three"), "Should contain line 3");
  });

  it("executes read with ranges", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("range.txt", "line one\nline two\nline three\nline four\nline five\n");
    const execute = calls.registerTool[0].execute;

    const result = await execute("call-3", { path: "range.txt", ranges: ["3-4"] }, null, null, { cwd: tmpDir });
    assert(!result.isError, `Unexpected error: ${result.content[0].text}`);

    // Range [3,4] expands to [2,5]
    const text = result.content[0].text;
    assert(text.includes("line two"), "Should contain boundary context line 2");
    assert(text.includes("line three"), "Should contain line 3");
    assert(text.includes("line four"), "Should contain line 4");
    assert(text.includes("line five"), "Should contain boundary context line 5");
  });

  it("returns error when path is missing", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    const execute = calls.registerTool[0].execute;
    const result = await execute("call-4", {}, null, null, { cwd: tmpDir });
    assert(result.isError, "Should return error when path is missing");
    assert(result.content[0].text.includes("path is required"), "Error should mention path requirement");
  });

  it("throws error for non-existent file", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    const execute = calls.registerTool[0].execute;
    const result = await execute("call-5", { path: "nonexistent.txt" }, null, null, { cwd: tmpDir });
    assert(result.isError, "Should return error for non-existent file");
    assert(result.content[0].text.includes("not found"), "Error should mention file not found");
  });
});

// ==============================================================================
// Execute function — multi-file reads
// ==============================================================================
describe("execute function — multi-file reads", () => {
  /** @type {string} */
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "gsd-ext-multi-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTmp(name, content) {
    writeFileSync(join(tmpDir, name), content);
    return name;
  }

  it("executes multi-file read with file_paths", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("a.txt", "file a content\n");
    writeTmp("b.txt", "file b content\n");
    const execute = calls.registerTool[0].execute;

    const result = await execute("call-m1", { file_paths: ["a.txt", "b.txt"] }, null, null, { cwd: tmpDir });
    assert(!result.isError, `Unexpected error: ${result.content[0].text}`);

    const text = result.content[0].text;
    assert(text.includes("--- a.txt ---"), "Should have header for file a");
    assert(text.includes("file a content"), "Should contain content of file a");
    assert(text.includes("--- b.txt ---"), "Should have header for file b");
    assert(text.includes("file b content"), "Should contain content of file b");
  });

  it("executes multi-file read with inline ranges", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("inline_a.txt", "line one\nline two\nline three\nline four\nline five\n");
    writeTmp("inline_b.txt", "alpha\nbeta\ngamma\ndelta\n");
    const execute = calls.registerTool[0].execute;

    const result = await execute(
      "call-m2",
      { file_paths: ["inline_a.txt:2-3", "inline_b.txt:1-2"] },
      null,
      null,
      { cwd: tmpDir },
    );
    assert(!result.isError, `Unexpected error: ${result.content[0].text}`);

    const text = result.content[0].text;
    assert(text.includes("--- inline_a.txt ---"));
    assert(text.includes("--- inline_b.txt ---"));
  });

  it("skips per-file errors in multi-file mode", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("exists.txt", "i exist\n");
    const execute = calls.registerTool[0].execute;

    const result = await execute("call-m3", { file_paths: ["exists.txt", "missing.txt"] }, null, null, { cwd: tmpDir });
    assert(!result.isError, "Multi-file should not fail on per-file errors");
    assert(result.content[0].text.includes("exists.txt"), "Should have content for existing file");
    assert(result.content[0].text.includes("missing.txt"), "Should mention missing file");
    assert(result.content[0].text.includes("error:"), "Should indicate error for missing file");
  });
});

// ==============================================================================
// Output format verification
// ==============================================================================
describe("execute function — output format", () => {
  /** @type {string} */
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "gsd-ext-fmt-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTmp(name, content) {
    writeFileSync(join(tmpDir, name), content);
    return name;
  }

  it("produces hash-prefixed lines with ref token", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("fmt_test.txt", "hello\nworld\n");
    const execute = calls.registerTool[0].execute;

    const result = await execute("call-f1", { path: "fmt_test.txt" }, null, null, { cwd: tmpDir });
    assert(!result.isError);

    const text = result.content[0].text;
    assert.match(text, /^[a-z]{2}\.1\thello$/m, "Line 1 should be hash-prefixed");
    assert.match(text, /^[a-z]{2}\.2\tworld$/m, "Line 2 should be hash-prefixed");
    assert.match(text, /^ref: [a-z]{2}\.1-[a-z]{2}\.2:[a-z]{6}$/m, "Should have ref token");
  });

  it("produces empty file sentinel for empty files", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("empty_ext.txt", "");
    const execute = calls.registerTool[0].execute;

    const result = await execute("call-f2", { path: "empty_ext.txt" }, null, null, { cwd: tmpDir });
    assert(!result.isError);
    assert.strictEqual(result.content[0].text, "(empty file)\n\nref: 0-0:aaaaaa");
  });

  it("rejects binary files", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("binary_ext.bin", Buffer.from("text\0binary\n"));
    const execute = calls.registerTool[0].execute;

    const result = await execute("call-f3", { path: "binary_ext.bin" }, null, null, { cwd: tmpDir });
    assert(result.isError, "Should return error for binary files");
    assert(result.content[0].text.includes("binary file"), "Error should mention binary file");
  });
});

// ==============================================================================
// Background process / error path handling
// ==============================================================================
describe("execute function — error paths", () => {
  /** @type {string} */
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "gsd-ext-err-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTmp(name, content) {
    writeFileSync(join(tmpDir, name), content);
    return name;
  }

  it("rejects paths outside project directory", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("inside.txt", "inside content\n");
    const execute = calls.registerTool[0].execute;

    // Try to read a file with absolute path outside projectDir
    const outsidePath = join(tmpDir, "outside.txt");
    writeFileSync(outsidePath, "this is outside");

    const result = await execute("call-e1", { path: outsidePath }, null, null, { cwd: join(tmpDir, "sub") });
    // Should either find the file outside project dir and reject it,
    // or not find it and report error
    assert(result.isError, "Should reject path outside project");
  });

  it("handles invalid ranges gracefully", async () => {
    const { pi, calls } = createMockPi();
    const mod = await import("../index.js");
    mod.default(pi);

    writeTmp("valid.txt", "content\n");
    const execute = calls.registerTool[0].execute;

    const result = await execute("call-e2", { path: "valid.txt", ranges: ["abc"] }, null, null, { cwd: tmpDir });
    assert(result.isError, "Should return error for invalid range");
  });
});
