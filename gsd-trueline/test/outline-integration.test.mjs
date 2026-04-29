// ==============================================================================
// Integration tests for outline dispatch (src/read/index.js)
// ==============================================================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { handleOutline, handleOutlineMulti, formatOutline } from "../src/read/index.js";
import { handleRead } from "../src/read/reader.js";

// ==============================================================================
// Test helpers
// ==============================================================================

/**
 * Write a string to a temp file and return the path and directory.
 * @param {string} filename
 * @param {string} content
 * @returns {Promise<{ dir: string, fp: string }>}
 */
async function writeTempFile(filename, content) {
  const dir = join(
    tmpdir(),
    "gsd-outline-int-" + Math.random().toString(36).slice(2),
  );
  await mkdir(dir, { recursive: true });
  const fp = join(dir, filename);
  await writeFile(fp, content, "utf-8");
  return { dir, fp };
}

/**
 * Check if text looks like outline output (line ranges followed by ": text").
 * @param {string} text
 * @returns {boolean}
 */
function isOutlineText(text) {
  // Outline text contains lines like "1-10: ..." or "(N symbols, M lines)"
  return /^\d+(-?\d*): /.test(text) || /^\(\d+ symbols/.test(text);
}

/**
 * Check if text looks like hash-prefixed content (hash.line\tcontent).
 * @param {string} text
 * @returns {boolean}
 */
function isHashPrefixed(text) {
  return /^[a-z]{2}\.\d+\t/.test(text);
}

// ==============================================================================
// formatOutline tests
// ==============================================================================

describe("formatOutline", () => {
  it("returns empty footer for empty entries", () => {
    assert.equal(formatOutline([], 0), "(0 symbols, 0 source lines)");
  });

  it("formats code-style entries (startLine/endLine/nodeType/text)", () => {
    const entries = [
      { startLine: 1, endLine: 10, depth: 0, nodeType: "skipGroup", text: "(10 imports)" },
      { startLine: 25, endLine: 25, depth: 0, nodeType: "function", text: "function foo(bar) {" },
      { startLine: 33, endLine: 33, depth: 0, nodeType: "class", text: "class Bar {" },
    ];
    const result = formatOutline(entries, 150);
    assert.match(result, /^1-10: \(10 imports\)/);
    assert.match(result, /^25: function foo/m);
    assert.match(result, /^33: class Bar/m);
    assert.match(result, /\(2 symbols, 150 source lines\)/);
  });

  it("formats markdown/XML-style entries (lineNumber/endLine/type/text)", () => {
    const entries = [
      { type: "h1", depth: 0, text: "My Title", lineNumber: 1, endLine: 1 },
      { type: "fenced_code", depth: 0, text: "```js (5 lines)", lineNumber: 3, endLine: 8 },
      { type: "table", depth: 0, text: "| A | B | (3 rows, 2 cols)", lineNumber: 10, endLine: 14 },
    ];
    const result = formatOutline(entries, 30);
    assert.match(result, /^1: My Title/m);
    assert.match(result, /^3-8: ```js/m);
    assert.match(result, /^10-14: \| A \| B \|/m);
    assert.match(result, /\(3 symbols, 30 source lines\)/);
  });
});

// ==============================================================================
// handleOutline integration tests
// ==============================================================================

describe("handleOutline — code files", () => {
  it("produces outline for .js file without params", async () => {
    const { dir, fp } = await writeTempFile(
      "test.js",
      [
        'import { readFile } from "node:fs/promises";',
        'import { join } from "node:path";',
        "",
        "function greet(name) {",
        '  return `Hello, ${name}!`;',
        "}",
        "",
        "class Calculator {",
        "  add(a, b) { return a + b; }",
        "}",
        "",
        "const PI = 3.14159;",
      ].join("\n"),
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.ok(result, "result should not be null");
      assert.ok(!result.isError, "result should not be an error");
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.ok(isOutlineText(text), "outline should contain line ranges");
      assert.match(text, /^4-7: function greet/m, "should find function spanning 4-7");
      assert.match(text, /^8-11: class Calculator/m, "should find class spanning 8-11");
      assert.match(text, /\(3 symbols/, "should count 3 symbols (imports are skipGroup)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("produces outline for .ts file", async () => {
    const { dir, fp } = await writeTempFile(
      "app.ts",
      [
        "import { Component } from '@angular/core';",
        "",
        "interface User {",
        "  name: string;",
        "  age: number;",
        "}",
        "",
        "class AppComponent {",
        "  title = 'app';",
        "}",
      ].join("\n"),
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.ok(result);
      assert.ok(!result.isError);
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.match(text, /^3-7: interface User/m, "should find interface spanning 3-7");
      assert.match(text, /^8-10: class AppComponent/m, "should find class spanning 8-10");
      assert.match(text, /\(2 symbols/, "should count 2 symbols");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("produces outline for .py file", async () => {
    const { dir, fp } = await writeTempFile(
      "main.py",
      ["import os", "from pathlib import Path", "", "", "def main():", "    print('hello')", "", "", "class Handler:", "    pass"].join("\n"),
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.ok(result);
      assert.ok(!result.isError);
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.match(text, /^5-8: def main/m, "should find function spanning 5-8");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("handleOutline — markdown files", () => {
  it("produces markdown outline for .md file", async () => {
    const { dir, fp } = await writeTempFile(
      "readme.md",
      [
        "# My Project",
        "",
        "Welcome to my project.",
        "",
        "## Installation",
        "",
        "Run `npm install`.",
        "",
        "## Usage",
        "",
        "```js",
        "const x = 1;",
        "console.log(x);",
        "```",
        "",
        "### API",
        "",
        "| Name | Type |",
        "|------|------|",
        "| foo  | bar  |",
        "| baz  | qux  |",
        "",
      ].join("\n"),
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.ok(result, "markdown should produce outline");
      assert.ok(!result.isError);
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.match(text, /^1-4: My Project/m, "should find h1 spanning 1-4");
      assert.match(text, /^5-8: Installation/m, "should find h2 spanning 5-8");
      assert.match(text, /^9-13: Usage/m, "should find h2 spanning 9-13");
      assert.match(text, /^11-14: ```js/m, "should find code block");
      assert.match(text, /^16-21: API/m, "should find h3 spanning 16-21");
      assert.match(text, /\(6 symbols/, "should count symbols");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("produces outline for .markdown file", async () => {
    const { dir, fp } = await writeTempFile(
      "doc.markdown",
      ["# Title", "", "Some text."].join("\n"),
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.ok(result);
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.match(text, /^1-3: Title/m, "should find heading spanning 1-3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("handleOutline — XML files", () => {
  it("produces XML outline for .xml file", async () => {
    const { dir, fp } = await writeTempFile(
      "data.xml",
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<root>",
        "  <child attr='val'>text</child>",
        "  <empty />",
        "</root>",
      ].join("\n"),
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.ok(result, "XML should produce outline");
      assert.ok(!result.isError);
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.match(text, /^2-5: <root>/m, "should find root element spanning 2-5");
      assert.match(text, /^3: <child/m, "should find child element on line 3");
      assert.match(text, /^4: <empty \/>/m, "should find self-closing element on line 4");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("produces outline for .svg file", async () => {
    const { dir, fp } = await writeTempFile(
      "icon.svg",
      ['<svg xmlns="http://www.w3.org/2000/svg">', "  <circle cx='10' cy='10' r='5' />", "</svg>"].join("\n"),
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.ok(result);
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.match(text, /^1-3: <svg/m, "should find svg element spanning 1-3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("handleOutline — unsupported files", () => {
  it("returns null for unsupported .json file", async () => {
    const { dir, fp } = await writeTempFile(
      "data.json",
      '{"key": "value"}',
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.strictEqual(result, null, "unsupported extensions should return null");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for unsupported .txt file", async () => {
    const { dir, fp } = await writeTempFile(
      "readme.txt",
      "Just text.",
    );

    try {
      const result = await handleOutline({ file_path: fp, projectDir: dir });
      assert.strictEqual(result, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("handleOutline — error handling", () => {
  it("returns error for non-existent file", async () => {
    const result = await handleOutline({
      file_path: "/nonexistent/path.js",
      projectDir: "/tmp",
    });
    assert.ok(result);
    assert.ok(result.isError, "should return error for missing file");
    const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
    assert.match(text, /not found/i, "should mention file not found");
  });
});

// ==============================================================================
// handleOutlineMulti integration tests
// ==============================================================================

describe("handleOutlineMulti", () => {
  it("produces outlines for multiple supported files", async () => {
    const dir = join(
      tmpdir(),
      "gsd-outline-multi-" + Math.random().toString(36).slice(2),
    );
    await mkdir(dir, { recursive: true });
    const fp1 = join(dir, "a.js");
    const fp2 = join(dir, "b.md");
    await writeFile(fp1, "function foo() {}\n", "utf-8");
    await writeFile(fp2, "# Heading\n", "utf-8");

    try {
      const result = await handleOutlineMulti({
        file_paths: [fp1, fp2],
        projectDir: dir,
      });
      assert.ok(result, "multi outline should produce result");
      assert.ok(!result.isError);
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.ok(text.includes("--- " + fp1), "should include first file header");
      assert.ok(text.includes("--- " + fp2), "should include second file header");
      assert.match(text, /function foo/, "should include js outline");
      assert.match(text, /Heading/, "should include md outline");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when all files are unsupported", async () => {
    const { dir, fp } = await writeTempFile("data.json", "{}");

    try {
      const result = await handleOutlineMulti({
        file_paths: [fp],
        projectDir: dir,
      });
      assert.strictEqual(result, null, "should return null when all files unsupported");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tolerates individual file errors (missing file in batch)", async () => {
    const dir = join(
      tmpdir(),
      "gsd-outline-err-" + Math.random().toString(36).slice(2),
    );
    await mkdir(dir, { recursive: true });
    const fp1 = join(dir, "exists.js");
    await writeFile(fp1, "function foo() {}\n", "utf-8");
    const fp2 = join(dir, "missing.js"); // doesn't exist

    try {
      const result = await handleOutlineMulti({
        file_paths: [fp1, fp2],
        projectDir: dir,
      });
      assert.ok(result, "should still produce result");
      const text = /** @type {string} */ (result.content?.[0]?.text ?? "");
      assert.match(text, /function foo/, "should include good file outline");
      assert.match(text, /error/, "should report error for missing file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
