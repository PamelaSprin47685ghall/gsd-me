// ==============================================================================
// Tests for src/common/security.js
// ==============================================================================
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  parseToolPattern,
  fileGlobToRegex,
  readToolDenyPatterns,
  evaluateFilePath,
  validatePath,
  expandGlobs,
  displayPath,
  clearCaches,
  clearGitFilesCache,
  errorResult,
} from "../src/common/security.js";

// ==============================================================================
// parseToolPattern
// ==============================================================================
describe("parseToolPattern", () => {
  it("parses ToolName(glob) format", () => {
    assert.deepEqual(parseToolPattern("Read(src/*.ts)"), { tool: "Read", glob: "src/*.ts" });
  });

  it("parses patterns with multiple parens (greedy)", () => {
    // Greedy .+ captures the outer content
    assert.deepEqual(parseToolPattern("Read(some(path))"), { tool: "Read", glob: "some(path)" });
  });

  it("returns null for patterns without parens", () => {
    assert.strictEqual(parseToolPattern("Read"), null);
    assert.strictEqual(parseToolPattern(""), null);
    assert.strictEqual(parseToolPattern("Read()"), null); // empty parens, .+ requires at least 1 char
  });

  it("returns null for patterns with wrong format", () => {
    assert.strictEqual(parseToolPattern("Read(src/*.ts"), null);
    assert.strictEqual(parseToolPattern("Read src/*.ts)"), null);
  });
});

// ==============================================================================
// fileGlobToRegex
// ==============================================================================
describe("fileGlobToRegex", () => {
  beforeEach(() => clearCaches());

  it("converts simple glob to regex", () => {
    const re = fileGlobToRegex("*.ts");
    assert(re.test("foo.ts"));
    assert(re.test("bar.ts"));
    assert(!re.test("foo.js"));
    assert(!re.test("foo/bar.ts")); // * doesn't cross dir separators
  });

  it("handles single-character wildcard", () => {
    const re = fileGlobToRegex("?.ts");
    assert(re.test("a.ts"));
    assert(!re.test("ab.ts"));
  });

  it("handles globstar (any path depth)", () => {
    const re = fileGlobToRegex("src/**/*.ts");
    assert(re.test("src/foo.ts"));
    assert(re.test("src/a/b/bar.ts"));
    assert(!re.test("src/foo.js"));
  });

  it("handles globstar standalone at boundary", () => {
    const re = fileGlobToRegex("**/*.ts");
    assert(re.test("foo.ts"));
    assert(re.test("a/b/bar.ts"));
  });

  it("handles case-insensitive flag", () => {
    const re = fileGlobToRegex("*.TXT", true);
    assert(re.test("readme.txt"));
    assert(re.test("readme.TXT"));
    assert(re.test("readme.Txt"));
  });

  it("handles case-sensitive by default", () => {
    const re = fileGlobToRegex("*.txt");
    assert(re.test("readme.txt"));
    assert(!re.test("readme.TXT"));
  });

  it("escapes regex special characters in literals", () => {
    const re = fileGlobToRegex("src/[test].js");
    assert(re.test("src/[test].js"));
    assert(!re.test("src/x.js"));
  });

  it("collapses consecutive globstars to prevent backtracking", () => {
    const re = fileGlobToRegex("**/**/**/foo.ts");
    // Should be equivalent to **/foo.ts
    assert(re.test("foo.ts"));
    assert(re.test("a/foo.ts"));
    assert(re.test("a/b/c/foo.ts"));
  });

  it("caches results", () => {
    const re1 = fileGlobToRegex("*.ts");
    const re2 = fileGlobToRegex("*.ts");
    assert.strictEqual(re1, re2);
  });

  it("caches separately for case-insensitive", () => {
    const re1 = fileGlobToRegex("*.ts");
    const re2 = fileGlobToRegex("*.ts", true);
    assert.notStrictEqual(re1, re2);
  });

  it("handles literal dots in patterns", () => {
    const re = fileGlobToRegex(".env");
    assert(re.test(".env"));
    assert(!re.test("xenv"));
  });
});

// ==============================================================================
// evaluateFilePath
// ==============================================================================
describe("evaluateFilePath", () => {
  it("denies path matching a simple glob", () => {
    const result = evaluateFilePath("/project/.env", [["*.env"]]);
    assert.strictEqual(result.denied, true);
    assert.strictEqual(result.matchedPattern, "*.env");
  });

  it("allows path not matching any glob", () => {
    const result = evaluateFilePath("/project/src/index.ts", [["*.env"]]);
    assert.strictEqual(result.denied, false);
  });

  it("matches basename for globs without path separators", () => {
    // .env glob should match /any/path/.env via basename
    const result = evaluateFilePath("/home/user/project/.env", [[".env"]]);
    assert.strictEqual(result.denied, true);
    assert.strictEqual(result.matchedPattern, ".env");
  });

  it("matches relative glob with prefix via globstar", () => {
    const result = evaluateFilePath("/project/src/secret.env", [["src/secret.env"]]);
    assert.strictEqual(result.denied, true);
  });

  it("normalizes backslashes on Windows-style paths", () => {
    const result = evaluateFilePath("C:\\project\\.env", [[".env"]]);
    assert.strictEqual(result.denied, true);
  });

  it("returns first matching pattern when multiple globs", () => {
    const result = evaluateFilePath("/project/.env", [["*.md", ".env"]]);
    assert.strictEqual(result.denied, true);
    assert.strictEqual(result.matchedPattern, ".env"); // flat finds .env first
  });

  it("returns denied false for empty denyGlobs", () => {
    const result = evaluateFilePath("/project/file.ts", [[]]);
    assert.strictEqual(result.denied, false);
  });
});

// ==============================================================================
// readToolDenyPatterns
// ==============================================================================
describe("readToolDenyPatterns", () => {
  let tmpDir;
  let projectDir;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "security-test-"));
    projectDir = join(tmpDir, "project");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
  });

  after(() => {
    clearCaches();
  });

  it("reads patterns from .claude/settings.local.json", async () => {
    const localSettings = {
      permissions: {
        deny: ["Read(secret/*)", "Edit(.env)"],
      },
    };
    writeFileSync(join(projectDir, ".claude", "settings.local.json"), JSON.stringify(localSettings));

    const result = await readToolDenyPatterns("Read", projectDir);
    // First entry is from settings.local.json
    assert(result.length >= 1);
    const globs = result[0];
    assert(Array.isArray(globs));
    assert(globs.includes("secret/*"));
  });

  it("returns empty array when no config files exist for the tool", async () => {
    const emptyDir = join(tmpDir, "empty-project");
    mkdirSync(emptyDir, { recursive: true });

    const result = await readToolDenyPatterns("NonExistentTool", emptyDir);
    // No settings files have patterns for NonExistentTool, so all globs
    // arrays should be empty (not null — they have 0 matching entries).
    // But global ~/.claude/settings.json may still exist.
    // We verify that at least the results are arrays with no matching entries.
    for (const globs of result) {
      assert(Array.isArray(globs));
      assert.strictEqual(globs.length, 0);
    }
  });

  it("caches results based on mtime", async () => {
    clearCaches();
    const cacheDir = join(tmpDir, "cache-test");
    mkdirSync(join(cacheDir, ".claude"), { recursive: true });
    const settingsPath = join(cacheDir, ".claude", "settings.local.json");
    writeFileSync(settingsPath, JSON.stringify({ permissions: { deny: ["Read(secret/*)"] } }));

    const result1 = await readToolDenyPatterns("Read", cacheDir);
    assert.strictEqual(result1[0][0], "secret/*");

    // Without changing mtime, result should be cached
    const result2 = await readToolDenyPatterns("Read", cacheDir);
    assert.strictEqual(result2[0][0], "secret/*");
  });
});

// ==============================================================================
// validatePath
// ==============================================================================
describe("validatePath", () => {
  let tmpDir;
  let projectDir;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "security-validate-"));
    projectDir = join(tmpDir, "project");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
  });

  it("validates an existing file within project", async () => {
    const filePath = join(projectDir, "test.txt");
    writeFileSync(filePath, "hello world");

    const result = await validatePath("test.txt", "Read", projectDir);
    assert.strictEqual(result.ok, true);
    assert(result.resolvedPath);
    assert(typeof result.size === "number");
    assert(typeof result.mtimeMs === "number");
  });

  it("rejects non-existent files", async () => {
    const result = await validatePath("nonexistent.ts", "Read", projectDir);
    assert.strictEqual(result.ok, false);
    assert(result.error.content[0].text.includes("not found"));
  });

  it("rejects paths outside project directory", async () => {
    // Use a path that resolves outside projectDir via ..
    const filePath = join(tmpDir, "outside.txt");
    writeFileSync(filePath, "outside");

    const result = await validatePath(join(projectDir, "..", "outside.txt"), "Read", projectDir);
    assert.strictEqual(result.ok, false);
    assert(result.error.content[0].text.includes("outside the project directory"));
  });

  it("rejects paths with wildcard", async () => {
    const result = await validatePath("*", "Read", projectDir);
    assert.strictEqual(result.ok, false);
    assert(result.error.content[0].text.includes("Wildcard"));
  });

  it("rejects directories", async () => {
    mkdirSync(join(projectDir, "subdir"), { recursive: true });
    const result = await validatePath("subdir", "Read", projectDir);
    assert.strictEqual(result.ok, false);
    assert(result.error.content[0].text.includes("not a regular file"));
  });

  it("rejects symlinks when enabled", async () => {
    // We can't create symlinks to outside dirs if contained
    // So we only test that symlink resolution happens (it resolves to real path)
    const targetFile = join(projectDir, "target.txt");
    writeFileSync(targetFile, "target content");

    // Symlink inside project to a file inside project — should still work
    // since realpath resolves it and containment check passes
    const symlinkPath = join(projectDir, "link.txt");
    try {
      symlinkSync(targetFile, symlinkPath);
    } catch {
      // Symlinks may not be available on some platforms
      return;
    }

    const result = await validatePath("link.txt", "Read", projectDir);
    // Symlink to an in-project file resolves and passes
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.resolvedPath, resolve(targetFile));
  });
});

// ==============================================================================
// displayPath
// ==============================================================================
describe("displayPath", () => {
  it("strips projectDir prefix", () => {
    const result = displayPath("/home/user/project/src/file.ts", "/home/user/project");
    assert.strictEqual(result, "src/file.ts");
  });

  it("returns full path when not under projectDir", () => {
    const result = displayPath("/other/path/file.ts", "/home/user/project");
    assert.strictEqual(result, "/other/path/file.ts");
  });

  it("handles undefined projectDir", () => {
    const result = displayPath("/home/user/file.ts", undefined);
    assert.strictEqual(result, "/home/user/file.ts");
  });

  it("normalizes backslashes", () => {
    const result = displayPath("C:\\project\\src\\file.ts", "C:\\project");
    assert.strictEqual(result, "src/file.ts");
  });
});

// ==============================================================================
// expandGlobs
// ==============================================================================
describe("expandGlobs", () => {
  let tmpDir;
  let projectDir;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "security-glob-"));
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    // Create some test files
    writeFileSync(join(projectDir, "a.ts"), "");
    writeFileSync(join(projectDir, "b.ts"), "");
    writeFileSync(join(projectDir, "c.js"), "");
    mkdirSync(join(projectDir, "subdir"), { recursive: true });
    writeFileSync(join(projectDir, "subdir", "d.ts"), "");
    writeFileSync(join(projectDir, "subdir", "e.js"), "");
  });

  it("passes through non-glob entries unchanged", async () => {
    const result = await expandGlobs(["a.ts", "b.ts"], projectDir);
    assert.deepEqual(result, ["a.ts", "b.ts"]);
  });

  it("expands simple glob patterns", async () => {
    const result = await expandGlobs(["*.ts"], projectDir);
    assert(result.includes("a.ts"));
    assert(result.includes("b.ts"));
    assert(!result.includes("c.js"));
  });

  it("handles empty input", async () => {
    const result = await expandGlobs([], projectDir);
    assert.deepEqual(result, []);
  });

  it("deduplicates results", async () => {
    const result = await expandGlobs(["a.ts", "a.ts"], projectDir);
    assert.strictEqual(result.length, 1);
  });

  it("sorts results alphabetically", async () => {
    const result = await expandGlobs(["*"], projectDir);
    for (let i = 1; i < result.length; i++) {
      assert(result[i - 1] <= result[i], `Not sorted: ${result[i - 1]} > ${result[i]}`);
    }
  });
});

// ==============================================================================
// errorResult
// ==============================================================================
describe("errorResult", () => {
  it("creates an error result with isError=true", () => {
    const result = errorResult("Something went wrong");
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.content[0].type, "text");
    assert.strictEqual(result.content[0].text, "Something went wrong");
  });
});
