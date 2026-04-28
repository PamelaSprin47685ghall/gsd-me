// ==============================================================================
// Tests for src/read/outline.js
// ==============================================================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LANGUAGE_CONFIGS,
  getConfig,
  getExtension,
  extractOutlineFromLines,
  formatOutline,
} from "../src/read/outline.js";

// ==============================================================================
// Helpers
// ==============================================================================

/**
 * Convert a string into an async iterable of RawLine objects.
 * @param {string} content
 * @returns {AsyncIterable<{lineBytes: Buffer, lineNumber: number}>}
 */
async function* contentLines(content) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    yield {
      lineBytes: Buffer.from(lines[i]),
      lineNumber: i + 1,
    };
  }
}

/**
 * Extract outline from inline content for a given language extension.
 * @param {string} content
 * @param {string} ext
 * @returns {Promise<{entries: import('../src/read/outline.js').OutlineEntry[], totalLines: number}>}
 */
async function outlineFrom(content, ext) {
  const config = getConfig(ext);
  if (!config) return { entries: [], totalLines: 0 };
  return extractOutlineFromLines(contentLines(content), config);
}

// ==============================================================================
// Config tests
// ==============================================================================

describe("getConfig", () => {
  it("returns config for known extensions", () => {
    assert.ok(getConfig(".js"));
    assert.ok(getConfig(".ts"));
    assert.ok(getConfig(".py"));
    assert.ok(getConfig(".go"));
    assert.ok(getConfig(".rs"));
    assert.ok(getConfig(".java"));
    assert.ok(getConfig(".c"));
    assert.ok(getConfig(".cpp"));
  });

  it("returns same config for aliased extensions", () => {
    assert.strictEqual(getConfig(".mjs"), getConfig(".js"));
    assert.strictEqual(getConfig(".cjs"), getConfig(".js"));
    assert.strictEqual(getConfig(".tsx"), getConfig(".ts"));
    assert.strictEqual(getConfig(".h"), getConfig(".c"));
    assert.strictEqual(getConfig(".hpp"), getConfig(".cpp"));
  });

  it("returns null for unknown extensions", () => {
    assert.strictEqual(getConfig(".unknown"), null);
    assert.strictEqual(getConfig(""), null);
  });
});

describe("getExtension", () => {
  it("extracts extension from file path", () => {
    assert.strictEqual(getExtension("foo.js"), ".js");
    assert.strictEqual(getExtension("src/foo.ts"), ".ts");
    assert.strictEqual(getExtension("/path/to/foo.test.mjs"), ".mjs");
  });

  it("returns null for paths without extension", () => {
    assert.strictEqual(getExtension("Makefile"), null);
    assert.strictEqual(getExtension("src/foo"), null);
  });
});

// ==============================================================================
// JavaScript outline tests
// ==============================================================================

describe("JavaScript (.js) outline", () => {
  it("detects function declarations", async () => {
    const { entries, totalLines } = await outlineFrom(
      `function foo() {
  return 1;
}

function bar() {
  return 2;
}
`,
      ".js",
    );
    assert.strictEqual(totalLines, 8);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].nodeType, "function");
    assert.strictEqual(entries[0].startLine, 1);
    assert.strictEqual(entries[1].nodeType, "function");
    assert.strictEqual(entries[1].startLine, 5);
  });

  it("detects async functions", async () => {
    const { entries } = await outlineFrom(
      `async function fetchData() {
  return await fetch("/api");
}
`,
      ".js",
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].nodeType, "function");
    assert.ok(entries[0].text.startsWith("async function"));
  });

  it("detects classes", async () => {
    const { entries } = await outlineFrom(
      `class Foo {
  constructor() {}
  bar() {}
}
`,
      ".js",
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].nodeType, "class");
    assert.strictEqual(entries[0].startLine, 1);
  });

  it("detects generator functions", async () => {
    const { entries } = await outlineFrom(
      `function* range(start, end) {
  for (let i = start; i <= end; i++) yield i;
}
`,
      ".js",
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].nodeType, "function");
    assert.ok(entries[0].text.includes("function*"));
  });

  it("collapses import skip groups", async () => {
    const { entries } = await outlineFrom(
      `import { foo } from "./foo";
import { bar } from "./bar";
import { baz } from "./baz";

function greet() {
  console.log("hello");
}
`,
      ".js",
    );
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].nodeType, "skipGroup");
    assert.strictEqual(entries[0].text, "(3 imports)");
    assert.strictEqual(entries[0].startLine, 1);
    assert.strictEqual(entries[0].endLine, 3);
    assert.strictEqual(entries[1].nodeType, "function");
    assert.strictEqual(entries[1].startLine, 5);
  });

  it("detects const declarations as structural elements", async () => {
    const { entries } = await outlineFrom(
      `const NAME = "gsd";
let count = 0;
var old = "deprecated";
`,
      ".js",
    );
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].nodeType, "declaration");
    assert.strictEqual(entries[1].nodeType, "declaration");
    assert.strictEqual(entries[2].nodeType, "declaration");
  });

  it("handles exported declarations", async () => {
    const { entries } = await outlineFrom(
      `export function util() {}
export class Widget {}
`,
      ".js",
    );
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].nodeType, "function");
    assert.strictEqual(entries[1].nodeType, "class");
  });
});

// ==============================================================================
// TypeScript outline tests
// ==============================================================================

describe("TypeScript (.ts) outline", () => {
  it("detects interfaces and types", async () => {
    const { entries } = await outlineFrom(
      `interface User {
  id: string;
  name: string;
}

type Callback = (err: Error | null) => void;

function process(): void {}
`,
      ".ts",
    );
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].nodeType, "interface");
    assert.strictEqual(entries[1].nodeType, "type");
    assert.strictEqual(entries[2].nodeType, "function");
  });

  it("detects enums", async () => {
    const { entries } = await outlineFrom(
      `enum Color {
  Red,
  Green,
  Blue,
}
`,
      ".ts",
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].nodeType, "enum");
    assert.strictEqual(entries[0].startLine, 1);
  });
});

// ==============================================================================
// Python outline tests
// ==============================================================================

describe("Python (.py) outline", () => {
  it("detects functions and classes", async () => {
    const { entries } = await outlineFrom(
      `import os
import sys

def greet(name):
    return f"Hello {name}"

class Calculator:
    def add(self, a, b):
        return a + b
`,
      ".py",
    );
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].nodeType, "skipGroup");
    assert.strictEqual(entries[0].text, "(2 imports)");
    assert.strictEqual(entries[1].nodeType, "function");
    assert.strictEqual(entries[1].startLine, 4);
    assert.strictEqual(entries[2].nodeType, "class");
    assert.strictEqual(entries[2].startLine, 7);
  });

  it("detects decorated definitions", async () => {
    const { entries } = await outlineFrom(
      `@app.route("/api")
def handler():
    return "ok"
`,
      ".py",
    );
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].nodeType, "decorator");
    assert.strictEqual(entries[1].nodeType, "function");
  });

  it("detects async functions", async () => {
    const { entries } = await outlineFrom(
      `async def fetch_data():
    return await request("/api")
`,
      ".py",
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].nodeType, "function");
    assert.ok(entries[0].text.startsWith("async def"));
  });
});

// ==============================================================================
// Go outline tests
// ==============================================================================

describe("Go (.go) outline", () => {
  it("detects functions and types", async () => {
    const { entries } = await outlineFrom(
      `package main

import "fmt"

func main() {
	fmt.Println("hello")
}

type Config struct {
	Name string
}

var version = "1.0"
`,
      ".go",
    );
    assert.strictEqual(entries.length, 5);
    assert.strictEqual(entries[0].nodeType, "skipGroup"); // package
    assert.strictEqual(entries[1].nodeType, "skipGroup"); // import
    assert.strictEqual(entries[2].nodeType, "function");
    assert.strictEqual(entries[2].startLine, 5);
    assert.strictEqual(entries[3].nodeType, "type");
    assert.strictEqual(entries[3].startLine, 9);
    assert.strictEqual(entries[4].nodeType, "declaration");
    assert.strictEqual(entries[4].startLine, 13);
  });
});

// ==============================================================================
// Rust outline tests
// ==============================================================================

describe("Rust (.rs) outline", () => {
  it("detects various structural elements", async () => {
    const { entries } = await outlineFrom(
      `use std::collections::HashMap;

fn greet(name: &str) -> String {
    format!("Hello {}", name)
}

struct Point {
    x: f64,
    y: f64,
}

enum Direction {
    North,
    South,
}

trait Draw {
    fn draw(&self);
}

impl Point {
    fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

const MAX: usize = 100;
`,
      ".rs",
    );
    // Check use skip group
    assert.strictEqual(entries[0].nodeType, "skipGroup");
    assert.strictEqual(entries[0].text, "(1 use)");

    // Check structural elements exist
    const types = entries.map((e) => e.nodeType);
    assert.ok(types.includes("function"));
    assert.ok(types.includes("struct"));
    assert.ok(types.includes("enum"));
    assert.ok(types.includes("trait"));
    assert.ok(types.includes("impl"));
    assert.ok(types.includes("declaration"));
  });

  it("detects pub visibility", async () => {
    const { entries } = await outlineFrom(
      `pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

pub struct User {
    pub id: u64,
}
`,
      ".rs",
    );
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].nodeType, "function");
    assert.strictEqual(entries[1].nodeType, "struct");
  });
});

// ==============================================================================
// Java outline tests
// ==============================================================================

describe("Java (.java) outline", () => {
  it("detects classes, methods, and skip groups", async () => {
    const { entries } = await outlineFrom(
      `package com.example;

import java.util.List;
import java.util.Map;

public class Main {
    private String name;

    public Main(String name) {
        this.name = name;
    }

    public void run() {
        System.out.println("running");
    }
}
`,
      ".java",
    );
    assert.strictEqual(entries.length, 5);
    assert.strictEqual(entries[0].nodeType, "skipGroup"); // package
    assert.strictEqual(entries[1].nodeType, "skipGroup"); // imports
    assert.strictEqual(entries[2].nodeType, "class");
    assert.strictEqual(entries[2].startLine, 6);
    assert.strictEqual(entries[3].nodeType, "method");
    assert.strictEqual(entries[3].startLine, 9);
    assert.strictEqual(entries[4].nodeType, "method");
    assert.strictEqual(entries[4].startLine, 13);
  });
});

// ==============================================================================
// C outline tests
// ==============================================================================

describe("C (.c) outline", () => {
  it("detects structures and functions", async () => {
    const { entries } = await outlineFrom(
      `#include <stdio.h>
#include <stdlib.h>

struct Point {
    int x;
    int y;
};

typedef struct {
    int id;
    char *name;
} User;

void greet(const char *name) {
    printf("Hello %s\\n", name);
}

int main(int argc, char **argv) {
    return 0;
}
`,
      ".c",
    );
    assert.strictEqual(entries.length, 5);
    assert.strictEqual(entries[0].nodeType, "skipGroup"); // includes
    assert.strictEqual(entries[1].nodeType, "struct");
    assert.strictEqual(entries[2].nodeType, "typedef");
    assert.strictEqual(entries[3].nodeType, "function");
    assert.strictEqual(entries[3].startLine, 14);
    assert.strictEqual(entries[4].nodeType, "function");
    assert.strictEqual(entries[4].startLine, 18);
  });
});

// ==============================================================================
// C++ outline tests
// ==============================================================================

describe("C++ (.cpp) outline", () => {
  it("detects classes, namespaces, and functions", async () => {
    const { entries } = await outlineFrom(
      `#include <iostream>
#include <vector>

namespace myapp {

class Widget {
public:
    Widget();
    void display();
};

void run() {
    std::cout << "running\\n";
}
}
`,
      ".cpp",
    );
    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0].nodeType, "skipGroup"); // includes
    assert.strictEqual(entries[1].nodeType, "namespace");
    assert.strictEqual(entries[2].nodeType, "class");
    assert.strictEqual(entries[3].nodeType, "function");
  });

  it("detects templates", async () => {
    const { entries } = await outlineFrom(
      `template <typename T>
class Box {
public:
    T value;
};
`,
      ".cpp",
    );
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].nodeType, "template");
    assert.strictEqual(entries[1].nodeType, "class");
  });
});

// ==============================================================================
// Edge case tests
// ==============================================================================

describe("Edge cases", () => {
  it("empty file returns no entries", async () => {
    const { entries, totalLines } = await outlineFrom("", ".js");
    assert.strictEqual(entries.length, 0);
    assert.strictEqual(totalLines, 1);
  });

  it("file with only imports returns single skip group", async () => {
    const { entries, totalLines } = await outlineFrom(
      `import { a } from "./a";
import { b } from "./b";
`,
      ".js",
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].nodeType, "skipGroup");
    assert.strictEqual(entries[0].text, "(2 imports)");
    assert.strictEqual(entries[0].startLine, 1);
    assert.strictEqual(entries[0].endLine, 2);
    assert.strictEqual(totalLines, 3);
  });

  it("file with no structural elements returns no symbols", async () => {
    const { entries } = await outlineFrom(
      `// just a comment
// another comment
const x = 1;
`,
      ".py",
    );
    // In Python, "const x = 1" is not a structural element
    // Neither are comments
    assert.strictEqual(entries.length, 0);
  });

  it("file with only whitespace returns no entries", async () => {
    const { entries, totalLines } = await outlineFrom("\n\n\n", ".js");
    assert.strictEqual(entries.length, 0);
    assert.strictEqual(totalLines, 4);
  });

  it("handles deeply nested constructs without false positives", async () => {
    const { entries } = await outlineFrom(
      `import { x } from "./x";

function outer() {
  function inner() {
    function deepest() {
      return 1;
    }
  }
}

class Container {
  method() {}
}
`,
      ".js",
    );
    // Should detect: import skip, outer(), class Container
    // inner and deepest are NOT detected (not on their own top-level line)
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].nodeType, "skipGroup");
    assert.strictEqual(entries[1].nodeType, "function");
    assert.strictEqual(entries[1].startLine, 3);
    assert.strictEqual(entries[2].nodeType, "class");
    assert.strictEqual(entries[2].startLine, 11);
  });

  it("handles single import without collapsing", async () => {
    const { entries } = await outlineFrom(
      `import { x } from "./x";

function foo() {}
`,
      ".js",
    );
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].nodeType, "skipGroup");
    assert.strictEqual(entries[0].text, "(1 import)");
    assert.strictEqual(entries[0].startLine, 1);
    assert.strictEqual(entries[0].endLine, 1);
  });

  it("handles mix of skip and non-skip lines", async () => {
    const { entries } = await outlineFrom(
      `import { x } from "./x";

const name = "test";

import { y } from "./y";

function foo() {}
`,
      ".js",
    );
    // Two skip groups separated by non-skip content
    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0].nodeType, "skipGroup"); // first import group
    assert.strictEqual(entries[1].nodeType, "declaration"); // const name
    assert.strictEqual(entries[2].nodeType, "skipGroup"); // second import group
    assert.strictEqual(entries[3].nodeType, "function"); // foo
  });
});

// ==============================================================================
// Multi-line signature tests
// ==============================================================================

describe("Multi-line signatures", () => {
  it("extends signature when line ends with opening paren", async () => {
    const { entries } = await outlineFrom(
      `function foo(
  bar: string,
  baz: number
): void {
  console.log("done");
}
`,
      ".ts",
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].nodeType, "function");
    assert.ok(entries[0].text.includes("bar"));
    assert.ok(entries[0].text.includes("baz"));
    assert.ok(entries[0].text.includes("): void"));
  });

  it("does not extend signature when parens are balanced on the same line", async () => {
    const { entries } = await outlineFrom(
      `function foo(bar: string): void {
  console.log("done");
}
`,
      ".ts",
    );
    assert.strictEqual(entries.length, 1);
    // Should NOT include the body line
    assert.ok(!entries[0].text.includes('console.log'));
  });

  it("limits extension to 10 lines", async () => {
    // Create a function with an absurdly long signature
    const lines = ['function foo('];
    for (let i = 0; i < 15; i++) {
      lines.push(`  param${i}: string,`);
    }
    lines.push('): void {');
    lines.push('  return;');
    lines.push('}');

    const { entries } = await outlineFrom(lines.join("\n"), ".ts");
    assert.strictEqual(entries.length, 1);
    // Should have extended, but content is truncated
    const text = entries[0].text;
    // The original line + up to 10 extra lines means we have code from param0..param9 or similar
    assert.ok(text.includes("function foo("));
    assert.ok(text.includes("param"), "should include some parameters from extension");
  });
});

// ==============================================================================
// Text truncation tests
// ==============================================================================

describe("Text truncation", () => {
  it("truncates lines over 200 characters", async () => {
    const longName = "a".repeat(250);
    const { entries } = await outlineFrom(
      `function ${longName}() {
  return;
}
`,
      ".js",
    );
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text.length, 201);
    assert.ok(entries[0].text.endsWith("…"));
  });
});

// ==============================================================================
// formatOutline tests
// ==============================================================================

describe("formatOutline", () => {
  it("formats skip groups and headings", () => {
    const entries = [
      { startLine: 1, endLine: 3, depth: 0, nodeType: "skipGroup", text: "(3 imports)" },
      { startLine: 5, endLine: 5, depth: 0, nodeType: "function", text: "function foo() {" },
      { startLine: 10, endLine: 10, depth: 0, nodeType: "class", text: "class Bar {" },
    ];
    const output = formatOutline(entries, 30);
    assert.ok(output.includes("1-3: (3 imports)"));
    assert.ok(output.includes("5: function foo() {"));
    assert.ok(output.includes("10: class Bar {"));
    assert.ok(output.includes("(2 symbols, 30 source lines)"));
  });

  it("returns zero symbols for empty entries", () => {
    const output = formatOutline([], 0);
    assert.strictEqual(output, "(0 symbols, 0 source lines)");
  });
});

// ==============================================================================
// Real-world scenarios
// ==============================================================================

describe("Real-world scenarios", () => {
  it("outlines full JavaScript module", async () => {
    const { entries, totalLines } = await outlineFrom(
      `import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_PORT = 3000;

function parseConfig(raw) {
  return JSON.parse(raw);
}

class Server {
  constructor(options) {
    this.options = options;
  }

  async start() {
    await this.listen();
  }

  async listen() {
    return new Promise((resolve) => {});
  }
}

export { Server };
`,
      ".js",
    );
    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0].nodeType, "skipGroup"); // imports
    assert.strictEqual(entries[1].nodeType, "declaration"); // DEFAULT_PORT
    assert.strictEqual(entries[2].nodeType, "function"); // parseConfig
    assert.strictEqual(entries[3].nodeType, "class"); // Server
    assert.strictEqual(totalLines, 25);
  });

  it("outlines Rust module with multiple constructs", async () => {
    const { entries } = await outlineFrom(
      `use crate::prelude::*;

pub fn setup() {
    println!("setup");
}

pub struct App {
    name: String,
}

impl App {
    pub fn new(name: &str) -> Self {
        Self { name: name.to_string() }
    }

    pub fn run(&self) {
        println!("running {}", self.name);
    }
}
`,
      ".rs",
    );
    const types = entries.map((e) => e.nodeType);
    assert.ok(types.includes("skipGroup"));
    assert.ok(types.includes("function"));
    assert.ok(types.includes("struct"));
    assert.ok(types.includes("impl"));
  });

  it("outlines Python module", async () => {
    const { entries } = await outlineFrom(
      `import json
from typing import Optional

def load_config(path: str) -> Optional[dict]:
    with open(path) as f:
        return json.load(f)

class ConfigManager:
    def __init__(self, path: str):
        self.path = path

    def reload(self) -> None:
        self.config = load_config(self.path)
`,
      ".py",
    );
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].nodeType, "skipGroup"); // imports
    assert.strictEqual(entries[1].nodeType, "function"); // load_config
    assert.strictEqual(entries[2].nodeType, "class"); // ConfigManager
  });

  it("outlines Go package", async () => {
    const { entries } = await outlineFrom(
      `package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println(os.Args[0])
}

func add(a, b int) int {
    return a + b
}
`,
      ".go",
    );
    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0].nodeType, "skipGroup"); // package
    assert.strictEqual(entries[1].nodeType, "skipGroup"); // import
    assert.strictEqual(entries[2].nodeType, "function"); // main
    assert.strictEqual(entries[3].nodeType, "function"); // add
  });
});
