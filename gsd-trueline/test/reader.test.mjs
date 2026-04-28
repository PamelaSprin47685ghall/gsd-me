// ==============================================================================
// Tests for src/read/reader.js — hash-verified streaming reader
// ==============================================================================
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { handleRead, handleReadMulti } from "../src/read/reader.js";
import {
  FNV_OFFSET_BASIS,
  fnv1aHashBytes,
  foldHash,
  hashToLetters,
  checksumToLetters,
  EMPTY_FILE_CHECKSUM,
} from "../src/common/hash.js";

// ==============================================================================
// Temp directory helper
// ==============================================================================

/** @type {string} */
let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gsd-reader-test-"));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Write content to a file in the temp directory.
 * @param {string} name - Relative filename
 * @param {string | Buffer} content
 * @returns {string} The relative path (for use with projectDir)
 */
function writeTmp(name, content) {
  writeFileSync(join(tmpDir, name), content);
  return name;
}

/**
 * Build a multi-line string from `n` lines starting at `startLine`.
 * Each line is "line {number}\n".
 * @param {number} n - Number of lines
 * @param {number} [start=1] - Starting line number
 * @returns {string}
 */
function makeLines(n, start = 1) {
  const result = [];
  for (let i = start; i < start + n; i++) {
    result.push(`line ${i}`);
  }
  return result.join("\n");
}

// ==============================================================================
// Output verification helpers
// ==============================================================================

/**
 * Parse a reader output string and verify all hashes and ref checksums.
 *
 * Each hash-prefixed line must have a valid 2-letter tag matching the
 * FNV-1a hash of the line content. Each ref token must have a valid
 * 6-letter checksum matching the foldHash chain of all lines in that range.
 *
 * @param {string} output - The raw output from handleRead / handleReadMulti
 * @returns {{ lines: Array<{letters: string, lineNum: number, content: string, h: number}>, refs: Array<{firstLine: number, lastLine: number, checksum: string}>, meta: string[] }}
 */
function parseAndVerifyOutput(output) {
  const lines = output.split("\n");
  const hashLineRegex = /^([a-z]{2})\.(\d+)\t(.*)$/;

  /** @type {Array<{letters: string, lineNum: number, content: string, h: number}>} */
  const hashLines = [];

  /** @type {Array<{firstLine: number, lastLine: number, checksum: string}>} */
  const refs = [];

  /** @type {string[]} */
  const meta = [];

  for (const line of lines) {
    const m = line.match(hashLineRegex);
    if (m) {
      const letters = m[1];
      const lineNum = Number(m[2]);
      const content = m[3];
      const buf = Buffer.from(content);
      const h = fnv1aHashBytes(buf, 0, buf.length);
      const expectedLetters = hashToLetters(h);
      assert.strictEqual(
        letters,
        expectedLetters,
        `Hash mismatch for line ${lineNum}: "${content}" expected "${expectedLetters}" got "${letters}"`,
      );
      hashLines.push({ letters, lineNum, content, h });
    } else if (line.startsWith("ref: ")) {
      const refParts = line.match(
        /^ref: ([a-z]{2})\.(\d+)-([a-z]{2})\.(\d+):([a-z]{6})$/,
      );
      assert(refParts, `Ref token format invalid: "${line}"`);
      const firstLine = Number(refParts[2]);
      const lastLine = Number(refParts[4]);
      const checksum = refParts[5];
      refs.push({ firstLine, lastLine, checksum });
    } else if (line) {
      meta.push(line);
    }
  }

  // Verify each ref's checksum
  for (const ref of refs) {
    const rangeHashes = hashLines.filter(
      (hl) => hl.lineNum >= ref.firstLine && hl.lineNum <= ref.lastLine,
    );
    assert(
      rangeHashes.length > 0,
      `No hash lines found for range ${ref.firstLine}-${ref.lastLine}`,
    );
    let acc = FNV_OFFSET_BASIS;
    for (const hl of rangeHashes) {
      acc = foldHash(acc, hl.h);
    }
    const expectedChecksum = checksumToLetters(acc);
    assert.strictEqual(
      expectedChecksum,
      ref.checksum,
      `Checksum mismatch for range ${ref.firstLine}-${ref.lastLine}: expected "${expectedChecksum}" got "${ref.checksum}"`,
    );
  }

  return { lines: hashLines, refs, meta };
}

// ==============================================================================
// handleRead — basic functionality
// ==============================================================================
describe("handleRead — basic functionality", () => {
  it("reads a file with no ranges (default whole-file)", async () => {
    writeTmp("basic.txt", makeLines(5));
    const result = await handleRead({ file_path: "basic.txt", projectDir: tmpDir });
    assert(!result.isError, `Unexpected error: ${result.content[0].text}`);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert.strictEqual(parsed.lines.length, 5);
    assert.strictEqual(parsed.refs.length, 1);
    assert.strictEqual(parsed.lines[0].lineNum, 1);
    assert.strictEqual(parsed.lines[4].lineNum, 5);
    assert.strictEqual(parsed.refs[0].firstLine, 1);
    assert.strictEqual(parsed.refs[0].lastLine, 5);
  });

  it("reads a file with explicit single range", async () => {
    writeTmp("range.txt", makeLines(20));
    const result = await handleRead({
      file_path: "range.txt",
      projectDir: tmpDir,
      ranges: ["5-10"],
    });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    // Range [5,10] expands to [4,11] (1-line boundary context)
    assert.strictEqual(parsed.lines.length, 8);
    assert.strictEqual(parsed.lines[0].lineNum, 4); // boundary context
    assert.strictEqual(parsed.lines[1].lineNum, 5);
    assert.strictEqual(parsed.lines[6].lineNum, 10);
    assert.strictEqual(parsed.lines[7].lineNum, 11); // boundary context
    assert.strictEqual(parsed.refs.length, 1);
    assert.strictEqual(parsed.refs[0].firstLine, 4);
    assert.strictEqual(parsed.refs[0].lastLine, 11);
  });

  it("reads a single line range", async () => {
    writeTmp("single.txt", makeLines(10));
    const result = await handleRead({
      file_path: "single.txt",
      projectDir: tmpDir,
      ranges: ["5"],
    });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    // Range [5,5] expands to [4,6]
    assert.strictEqual(parsed.lines.length, 3);
    assert.strictEqual(parsed.lines[0].lineNum, 4);
    assert.strictEqual(parsed.lines[1].lineNum, 5);
    assert.strictEqual(parsed.lines[2].lineNum, 6);
  });

  it("reads range from start (-N)", async () => {
    writeTmp("fromstart.txt", makeLines(10));
    const result = await handleRead({
      file_path: "fromstart.txt",
      projectDir: tmpDir,
      ranges: ["-5"],
    });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    // Range [1,5] — start=1 can't expand backward
    // Expanded: [1,6]
    assert.strictEqual(parsed.lines.length, 6);
    assert.strictEqual(parsed.lines[0].lineNum, 1);
    assert.strictEqual(parsed.lines[5].lineNum, 6);
  });

  it("reads range to EOF (N-)", async () => {
    writeTmp("toeof.txt", makeLines(10));
    const result = await handleRead({
      file_path: "toeof.txt",
      projectDir: tmpDir,
      ranges: ["8-"],
    });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    // Range [8,Infinity] — Infinity ranges don't expand at all
    // because the whole-file boundary context is meaningless.
    // Only lines 8-10 are output.
    assert.strictEqual(parsed.lines.length, 3);
    assert.strictEqual(parsed.lines[0].lineNum, 8);
    assert.strictEqual(parsed.lines[1].lineNum, 9);
    assert.strictEqual(parsed.lines[2].lineNum, 10);
    assert.strictEqual(parsed.refs[0].firstLine, 8);
    assert.strictEqual(parsed.refs[0].lastLine, 10);
  });

  it("reads multiple disjoint ranges", async () => {
    writeTmp("multirange.txt", makeLines(30));
    const result = await handleRead({
      file_path: "multirange.txt",
      projectDir: tmpDir,
      ranges: ["5-8", "20-22"],
    });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    // Range 1: [5,8] expands to [4,9]
    // Range 2: [20,22] expands to [19,23]
    assert.strictEqual(parsed.refs.length, 2);
    // First ref covers lines 4-9
    assert.strictEqual(parsed.refs[0].firstLine, 4);
    assert.strictEqual(parsed.refs[0].lastLine, 9);
    // Second ref covers lines 19-23
    assert.strictEqual(parsed.refs[1].firstLine, 19);
    assert.strictEqual(parsed.refs[1].lastLine, 23);
    // Total lines: 6 + 5 = 11
    assert.strictEqual(parsed.lines.length, 11);
  });
});

// ==============================================================================
// handleRead — edge cases
// ==============================================================================
describe("handleRead — edge cases", () => {
  it("returns empty file sentinel for empty file", async () => {
    writeTmp("empty.txt", "");
    const result = await handleRead({ file_path: "empty.txt", projectDir: tmpDir });
    assert(!result.isError);
    assert.strictEqual(result.content[0].text, "(empty file)\n\nref: 0-0:aaaaaa");
  });

  it("rejects binary files with clear error", async () => {
    writeTmp("binary.bin", Buffer.from("hello\0world\n"));
    const result = await handleRead({ file_path: "binary.bin", projectDir: tmpDir });
    assert(result.isError, "Expected error for binary file");
    assert(
      result.content[0].text.includes("binary file"),
      `Expected "binary file" in error, got: "${result.content[0].text}"`,
    );
    assert(
      result.content[0].text.includes("caution"),
      `Expected "caution" in error message, got: "${result.content[0].text}"`,
    );
  });

  it("rejects binary file even with null byte at end", async () => {
    writeTmp("binary2.bin", "text without null\0");
    const result = await handleRead({ file_path: "binary2.bin", projectDir: tmpDir });
    assert(result.isError);
    assert(result.content[0].text.includes("binary"));
  });

  it("returns error for out-of-range start line", async () => {
    writeTmp("short.txt", makeLines(5));
    const result = await handleRead({
      file_path: "short.txt",
      projectDir: tmpDir,
      ranges: ["10-20"],
    });
    assert(result.isError, "Expected error for out-of-range start");
    assert(
      result.content[0].text.includes("out of range"),
      `Expected "out of range" in error, got: "${result.content[0].text}"`,
    );
  });

  it("returns error for non-existent file", async () => {
    const result = await handleRead({
      file_path: "nonexistent.txt",
      projectDir: tmpDir,
    });
    assert(result.isError);
    assert(
      result.content[0].text.includes("not found"),
      `Expected "not found" in error, got: "${result.content[0].text}"`,
    );
  });

  it("handles file with no trailing newline (no change to hashing)", async () => {
    writeTmp("notrail.txt", "line A\nline B");
    const result = await handleRead({ file_path: "notrail.txt", projectDir: tmpDir });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert.strictEqual(parsed.lines.length, 2);
    assert.strictEqual(parsed.lines[0].lineNum, 1);
    assert.strictEqual(parsed.lines[1].lineNum, 2);
    // Verify line content is correct (line B has no trailing newline)
    assert.strictEqual(parsed.lines[0].content, "line A");
    assert.strictEqual(parsed.lines[1].content, "line B");
  });

  it("handles single-line file without newline", async () => {
    writeTmp("singleline.txt", "just one line");
    const result = await handleRead({ file_path: "singleline.txt", projectDir: tmpDir });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert.strictEqual(parsed.lines.length, 1);
    assert.strictEqual(parsed.lines[0].lineNum, 1);
    assert.strictEqual(parsed.lines[0].content, "just one line");
    assert.strictEqual(parsed.refs.length, 1);
    assert.strictEqual(parsed.refs[0].firstLine, 1);
    assert.strictEqual(parsed.refs[0].lastLine, 1);
  });

  it("preserves UTF-8 multi-byte content", async () => {
    writeTmp("utf8.txt", "héllo wörld\nこんにちは\n🚀 emoji\n");
    const result = await handleRead({ file_path: "utf8.txt", projectDir: tmpDir });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert.strictEqual(parsed.lines.length, 3);
    assert.strictEqual(parsed.lines[0].content, "héllo wörld");
    assert.strictEqual(parsed.lines[1].content, "こんにちは");
    assert.strictEqual(parsed.lines[2].content, "🚀 emoji");
  });

  it("handles very long file names and content", async () => {
    const longLine = "x".repeat(1000);
    writeTmp("long.txt", `${longLine}\n${longLine}\n`);
    const result = await handleRead({ file_path: "long.txt", projectDir: tmpDir });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert.strictEqual(parsed.lines.length, 2);
    assert.strictEqual(parsed.lines[0].content.length, 1000);
    assert.strictEqual(parsed.lines[1].content.length, 1000);
  });
});

// ==============================================================================
// handleRead — nudge behavior
// ==============================================================================
describe("handleRead — nudge for large full-file reads", () => {
  it("nudges for large full-file reads (>150 lines)", async () => {
    writeTmp("large.txt", makeLines(200));
    const result = await handleRead({ file_path: "large.txt", projectDir: tmpDir });
    assert(!result.isError);

    const text = result.content[0].text;
    assert(
      text.includes("consider ranges"),
      `Expected nudge, got: "${text.slice(-100)}"`,
    );
    const parsed = parseAndVerifyOutput(text);
    assert(parsed.meta.some((m) => m.includes("consider ranges")));
  });

  it("does not nudge for small full-file reads (<=150 lines)", async () => {
    writeTmp("small.txt", makeLines(100));
    const result = await handleRead({ file_path: "small.txt", projectDir: tmpDir });
    assert(!result.isError);

    const text = result.content[0].text;
    assert(!text.includes("consider ranges"));
  });

  it("does not nudge for ranged reads even if large", async () => {
    writeTmp("ranged_large.txt", makeLines(200));
    const result = await handleRead({
      file_path: "ranged_large.txt",
      projectDir: tmpDir,
      ranges: ["1-200"],
    });
    assert(!result.isError);

    const text = result.content[0].text;
    // Range [1,200] is explicit, not a full-file read
    assert(!text.includes("consider ranges"));
  });
});

// ==============================================================================
// handleRead — truncation
// ==============================================================================
describe("handleRead — truncation", () => {
  it("truncates at 2000 line limit", async () => {
    writeTmp("manylines.txt", makeLines(2500));
    const result = await handleRead({ file_path: "manylines.txt", projectDir: tmpDir });
    assert(!result.isError);

    const text = result.content[0].text;
    assert(
      text.includes("truncated"),
      `Expected truncation notice, got: "${text.slice(-200)}"`,
    );
    assert(text.includes("2000 line"));
    const parsed = parseAndVerifyOutput(text);
    // Should have at most 2000 hash lines (the truncated lines plus ref)
    assert(parsed.lines.length <= 2000);
  });

  it("still produces valid hashes and checksum for truncated output", async () => {
    writeTmp("trunc_verify.txt", makeLines(2500));
    const result = await handleRead({ file_path: "trunc_verify.txt", projectDir: tmpDir });
    assert(!result.isError);

    // parseAndVerifyOutput already checks hash validity
    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert(parsed.lines.length > 0);
    assert(parsed.refs.length >= 1);
    // Meta should contain truncation message
    assert(parsed.meta.some((m) => m.includes("truncated")));
  });
});

// ==============================================================================
// handleRead — path validation integration
// ==============================================================================
describe("handleRead — path validation", () => {
  it("rejects paths outside projectDir", async () => {
    // Use absolute path to a file outside the project
    const outsidePath = join(tmpDir, "outside.txt");
    writeFileSync(outsidePath, "this is outside");
    const result = await handleRead({
      file_path: outsidePath, // absolute path
      projectDir: join(tmpDir, "subdir"),
    });
    assert(result.isError, "Expected error for outside path");
    // Note: if allowedDirs is empty and file is outside projectDir,
    // security module rejects it
  });

  it("handles file with BOM prefix gracefully", async () => {
    // UTF-8 BOM is three bytes: EF BB BF
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    writeTmp("bom.txt", Buffer.concat([bom, Buffer.from("hello\nworld\n")]));
    const result = await handleRead({ file_path: "bom.txt", projectDir: tmpDir });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    // The BOM bytes are part of line 1 content (splitLines doesn't strip BOM)
    assert.strictEqual(parsed.lines.length, 2);
    assert.strictEqual(parsed.lines[1].content, "world");
  });
});

// ==============================================================================
// handleRead — encoding parameter acceptance
// ==============================================================================
describe("handleRead — encoding parameter", () => {
  it("accepts and ignores encoding parameter", async () => {
    writeTmp("enc.txt", "test content\n");
    const result = await handleRead({
      file_path: "enc.txt",
      projectDir: tmpDir,
      encoding: "utf-8",
    });
    assert(!result.isError);
    assert(result.content[0].text.includes("test content"));
  });
});

// ==============================================================================
// handleReadMulti — single file with top-level ranges
// ==============================================================================
describe("handleReadMulti — single file", () => {
  it("reads single file with top-level ranges", async () => {
    writeTmp("multi_single.txt", makeLines(20));
    const result = await handleReadMulti({
      file_paths: ["multi_single.txt"],
      projectDir: tmpDir,
      ranges: ["5-10"],
    });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    // Range [5,10] expands to [4,11]
    assert.strictEqual(parsed.lines.length, 8);
    assert.strictEqual(parsed.lines[0].lineNum, 4);
    assert.strictEqual(parsed.lines[7].lineNum, 11);
  });

  it("reads single file with inline range", async () => {
    writeTmp("inline_multi.txt", makeLines(15));
    const result = await handleReadMulti({
      file_paths: ["inline_multi.txt:3-7"],
      projectDir: tmpDir,
    });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    // Inline range [3,7] expands to [2,8]
    assert.strictEqual(parsed.lines.length, 7);
    assert.strictEqual(parsed.lines[0].lineNum, 2);
    assert.strictEqual(parsed.lines[6].lineNum, 8);
  });

  it("single file inline range takes precedence over top-level ranges", async () => {
    writeTmp("precedence.txt", makeLines(20));
    const result = await handleReadMulti({
      file_paths: ["precedence.txt:10-12"],
      projectDir: tmpDir,
      ranges: ["1-5"],
    });
    assert(!result.isError);

    // Inline range takes precedence: [10,12] expands to [9,13]
    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert.strictEqual(parsed.lines[0].lineNum, 9);
  });
});

// ==============================================================================
// handleReadMulti — multiple files
// ==============================================================================
describe("handleReadMulti — multiple files", () => {
  it("reads multiple files with inline ranges", async () => {
    writeTmp("mf1.txt", makeLines(5));
    writeTmp("mf2.txt", makeLines(3, 10));

    const result = await handleReadMulti({
      file_paths: ["mf1.txt", "mf2.txt"],
      projectDir: tmpDir,
    });
    assert(!result.isError);

    const text = result.content[0].text;
    // Should have "--- mf1.txt ---" and "--- mf2.txt ---" headers
    assert(text.includes("--- mf1.txt ---"), `Expected mf1 header in: "${text}"`);
    assert(text.includes("--- mf2.txt ---"), `Expected mf2 header in: "${text}"`);

    const parts = text.split("--- ");
    // Each file section is self-contained and hash-verified
    assert.strictEqual(parts.length, 3); // empty first + mf1 + mf2
  });

  it("skips per-file errors in multi-file mode", async () => {
    writeTmp("good.txt", "content\n");
    // Don't create bad.txt

    const result = await handleReadMulti({
      file_paths: ["good.txt", "bad.txt"],
      projectDir: tmpDir,
    });
    assert(!result.isError);

    const text = result.content[0].text;
    // Should have good.txt content and an error for bad.txt
    assert(text.includes("--- good.txt ---"));
    assert(text.includes("bad.txt"));
    assert(text.includes("error:"));
    assert(text.includes("not found"));
  });

  it("rejects top-level ranges with multiple files", async () => {
    writeTmp("mrej1.txt", makeLines(5));
    writeTmp("mrej2.txt", makeLines(5));

    const result = await handleReadMulti({
      file_paths: ["mrej1.txt", "mrej2.txt"],
      projectDir: tmpDir,
      ranges: ["1-3"],
    });
    assert(result.isError);
    assert(
      result.content[0].text.includes("Top-level ranges"),
      `Expected error about top-level ranges, got: "${result.content[0].text}"`,
    );
  });

  it("allows multiple files with inline ranges each", async () => {
    writeTmp("multi_1.txt", makeLines(20));
    writeTmp("multi_2.txt", makeLines(15, 5));

    const result = await handleReadMulti({
      file_paths: ["multi_1.txt:5-8", "multi_2.txt:10-12"],
      projectDir: tmpDir,
    });
    assert(!result.isError);

    const text = result.content[0].text;
    assert(text.includes("--- multi_1.txt ---"));
    assert(text.includes("--- multi_2.txt ---"));

    // Parse each section
    const sections = text.split("--- ").filter(Boolean);
    assert.strictEqual(sections.length, 2);
  });
});

// ==============================================================================
// handleRead — exact output format verification
// ==============================================================================
describe("handleRead — output format", () => {
  it("produces hash.line prefix format", async () => {
    writeTmp("fmt.txt", "hello\nworld\n");
    const result = await handleRead({ file_path: "fmt.txt", projectDir: tmpDir });
    assert(!result.isError);

    const lines = result.content[0].text.split("\n");
    // Line 1: "xx.1\thello"
    assert.match(lines[0], /^[a-z]{2}\.1\thello$/);
    // Line 2: "xx.2\tworld"
    assert.match(lines[1], /^[a-z]{2}\.2\tworld$/);
    // Line 3 (ref): "ref: xx.1-xx.2:xxxxxx"
    // But there's a \n before ref in the output
  });

  it("output format has correct structure: hash lines + ref", async () => {
    writeTmp("struct.txt", "a\nb\nc\n");
    const result = await handleRead({ file_path: "struct.txt", projectDir: tmpDir });
    assert(!result.isError);

    const text = result.content[0].text;
    // Structure: hash lines each followed by \n, then a \n before ref
    // so split("\n") produces:
    //   [0] = "xx.1\ta"
    //   [1] = "xx.2\tb"
    //   [2] = "xx.3\tc"
    //   [3] = ""           (empty due to leading \n in ref line)
    //   [4] = "ref: xx.1-xx.3:xxxxxx"
    const lines = text.split("\n");
    assert(lines.length >= 5);
    assert.match(lines[0], /^[a-z]{2}\.1\ta$/);
    assert.match(lines[1], /^[a-z]{2}\.2\tb$/);
    assert.match(lines[2], /^[a-z]{2}\.3\tc$/);
    assert.strictEqual(lines[3], "", "Line 3 should be empty (\\n before ref)");
    assert.match(lines[4], /^ref: [a-z]{2}\.1-[a-z]{2}\.3:[a-z]{6}$/);
  });
});

// ==============================================================================
// handleRead — large file performance (sanity checks)
// ==============================================================================
describe("handleRead — performance sanity", () => {
  it("reads 1000 lines without error", async () => {
    writeTmp("perf_1k.txt", makeLines(1000));
    const result = await handleRead({ file_path: "perf_1k.txt", projectDir: tmpDir });
    assert(!result.isError);

    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert.strictEqual(parsed.lines.length, 1000);
    assert.strictEqual(parsed.refs.length, 1);
  });

  it("correctly verifies ref checksum for 1000 lines", async () => {
    writeTmp("checksum_1k.txt", makeLines(1000));
    const result = await handleRead({ file_path: "checksum_1k.txt", projectDir: tmpDir });
    assert(!result.isError);

    // parseAndVerifyOutput already validates checksums — if this passes,
    // the checksum is correct for all 1000 lines
    const parsed = parseAndVerifyOutput(result.content[0].text);
    assert.strictEqual(parsed.lines.length, 1000);
  });
});

// ==============================================================================
// handleReadMulti — glob expansion
// ==============================================================================
describe("handleReadMulti — glob expansion", () => {
  it("expands non-recursive glob patterns", async () => {
    writeTmp("glob_a.txt", "file a\n");
    writeTmp("glob_b.txt", "file b\n");

    const result = await handleReadMulti({
      file_paths: ["glob_*.txt"],
      projectDir: tmpDir,
    });
    assert(!result.isError);

    const text = result.content[0].text;
    assert(text.includes("--- glob_a.txt ---"));
    assert(text.includes("--- glob_b.txt ---"));
  });

  it("non-glob paths pass through unchanged (single file, no path header)", async () => {
    writeTmp("noglob.txt", "no glob\n");

    const result = await handleReadMulti({
      file_paths: ["noglob.txt"],
      projectDir: tmpDir,
    });
    assert(!result.isError);
    // Single file dispatches to handleRead — output is hash-prefixed lines, no "--- filename ---" header
    const text = result.content[0].text;
    assert(text.includes("no glob"), `Expected content in: "${text}"`);
    assert(!text.includes("---"), "Single file should not have section headers");
  });
});
