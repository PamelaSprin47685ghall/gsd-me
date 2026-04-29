// ==============================================================================
// Tests for src/edit/verify.js
// ==============================================================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateEdits,
  verifyChecksum,
  verifyBoundaryHash,
} from "../src/edit/verify.js";

import {
  fnv1aHash,
  hashToLetters,
  foldHash,
  checksumToLetters,
  FNV_OFFSET_BASIS,
  EMPTY_FILE_CHECKSUM,
} from "../src/common/hash.js";

// ==============================================================================
// Helper: compute expected checksum letters for a set of lines
// ==============================================================================
function computeChecksumLetters(lines) {
  let acc = FNV_OFFSET_BASIS;
  for (const line of lines) {
    acc = foldHash(acc, fnv1aHash(line));
  }
  return checksumToLetters(acc);
}

// ==============================================================================
// validateEdits
// ==============================================================================
describe("validateEdits", () => {
  // ── Basic validation ─────────────────────────────────────────────────────

  it("rejects empty edits array", () => {
    const result = validateEdits([]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("No edits provided"));
    assert.strictEqual(result.ops.length, 0);
  });

  it("rejects non-array input", () => {
    const result = validateEdits(undefined);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("No edits provided"));
  });

  it("rejects null edit entry", () => {
    const result = validateEdits([null]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("invalid edit object"));
  });

  it("rejects edit with missing ref", () => {
    const result = validateEdits([
      { range: "ab.5", content: "new content", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("missing or empty ref"));
  });

  it("rejects edit with empty ref", () => {
    const result = validateEdits([
      { ref: "", range: "ab.5", content: "new content", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("missing or empty ref"));
  });

  it("rejects edit with missing range", () => {
    const result = validateEdits([
      { ref: "1-1:aaaaaa", content: "new content", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("missing or empty range"));
  });

  it("rejects edit with non-string content", () => {
    const result = validateEdits([
      { ref: "1-1:aaaaaa", range: "ab.5", content: 42, action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("content must be a string"));
  });

  // ── Action validation ────────────────────────────────────────────────────

  it("rejects invalid action", () => {
    const result = validateEdits([
      { ref: "1-1:aaaaaa", range: "ab.5", content: "hi", action: "delete" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('invalid action "delete"'));
  });

  it("rejects missing action", () => {
    const result = validateEdits([
      { ref: "1-1:aaaaaa", range: "ab.5", content: "hi" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('invalid action'));
  });

  // ── Range validation ─────────────────────────────────────────────────────

  it("rejects invalid range format", () => {
    const result = validateEdits([
      { ref: "1-1:aaaaaa", range: "not-a-range", content: "hi", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("invalid range"));
  });

  // ── Action/range consistency ─────────────────────────────────────────────

  it("rejects insert_after without + prefix", () => {
    const result = validateEdits([
      { ref: "1-1:aaaaaa", range: "ab.5", content: "new line", action: "insert_after" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('Use "+ab.5" syntax'));
  });

  it("rejects replace with + prefix", () => {
    const result = validateEdits([
      { ref: "1-1:aaaaaa", range: "+ab.5", content: "new line", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("uses insert-after (+"));
  });

  // ── Line 0 constraint ────────────────────────────────────────────────────

  it("rejects replace at line 0", () => {
    const result = validateEdits([
      { ref: "0-0:aaaaaa", range: "0", content: "hi", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("line 0 is only valid"));
  });

  it("accepts insert_after at +0 (prepend)", () => {
    const result = validateEdits([
      { ref: "0-0:aaaaaa", range: "+0", content: "prepended line\n", action: "insert_after" },
    ]);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ops.length, 1);
    assert.strictEqual(result.ops[0].startLine, 0);
    assert.strictEqual(result.ops[0].insertAfter, true);
  });

  // ── Ref validation ───────────────────────────────────────────────────────

  it("rejects invalid ref format", () => {
    const result = validateEdits([
      { ref: "not-a-ref", range: "ab.5", content: "hi", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("invalid ref"));
  });

  it("rejects ref that does not cover edit range (ref starts after edit)", () => {
    // Ref covers 10-20, but edit targets line 5
    const result = validateEdits([
      { ref: "10-20:" + computeChecksumLetters(["line10"]), range: "ab.5", content: "hi", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("does not cover edit range"));
  });

  it("rejects ref that does not cover edit range (ref ends before edit)", () => {
    // Ref covers 1-5, but edit targets lines 5-10
    const result = validateEdits([
      { ref: "1-5:" + computeChecksumLetters(["a", "b", "c", "d", "e"]), range: "ab.5-cd.10", content: "hi", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("does not cover edit range"));
  });

  it("accepts ref that exactly covers edit range", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      { ref: `1-5:${ck}`, range: "ab.1-cd.5", content: "replacement\ncontent\n", action: "replace" },
    ]);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ops.length, 1);
  });

  it("accepts ref that spans wider than edit range", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      { ref: `1-20:${ck}`, range: "ab.5-cd.10", content: "replacement\n", action: "replace" },
    ]);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ops.length, 1);
    assert.strictEqual(result.ops[0].refStartLine, 1);
    assert.strictEqual(result.ops[0].refEndLine, 20);
  });

  // ── Content size limit ───────────────────────────────────────────────────

  it("rejects content exceeding maxContentLines", () => {
    const manyLines = Array.from({ length: 250 }, (_, i) => `line${i}`).join("\n");
    const result = validateEdits(
      [{ ref: "1-1:aaaaaa", range: "ab.1", content: manyLines, action: "replace" }],
      200,
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("exceeds the limit"));
  });

  it("accepts content within limit", () => {
    const result = validateEdits(
      [{ ref: "1-1:aaaaaa", range: "ab.1", content: "reasonable content\n", action: "replace" }],
      200,
    );
    assert.strictEqual(result.valid, true);
  });

  // ── Hash.line leak detection ─────────────────────────────────────────────

  it("flags leaked hash.line references in content", () => {
    const result = validateEdits([
      {
        ref: "1-5:" + computeChecksumLetters(["a", "b", "c", "d", "e"]),
        range: "ab.1-cd.5",
        content: "some content with ab.12 and yz.99 in it",
        action: "replace",
      },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes("hash.line reference"));
    assert.ok(result.errors[0].includes('"ab.12"'));
    assert.ok(result.errors[0].includes('"yz.99"'));
  });

  it("does not flag content without hash.line patterns", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      {
        ref: `1-5:${ck}`,
        range: "ab.1-cd.5",
        content: "clean content without any hash references",
        action: "replace",
      },
    ]);
    assert.strictEqual(result.valid, true);
  });

  it("does not flag single-letter-dot-number patterns (needs exactly 2 letters)", () => {
    const lines = ["line1", "line2"];
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      {
        ref: `1-2:${ck}`,
        range: "ab.1-ab.2",
        content: "v.42 is not a hash line ref (single letter dot number)",
        action: "replace",
      },
    ]);
    assert.strictEqual(result.valid, true);
  });

  // ── Overlapping replace detection ────────────────────────────────────────

  it("rejects overlapping replace ranges", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      { ref: `1-20:${ck}`, range: "ab.5-cd.10", content: "first replacement\n", action: "replace" },
      { ref: `1-20:${ck}`, range: "yz.8-gh.12", content: "second replacement\n", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("overlap")));
  });

  it("accepts adjacent non-overlapping replace ranges", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      { ref: `1-20:${ck}`, range: "ab.1-cd.5", content: "first\n", action: "replace" },
      { ref: `1-20:${ck}`, range: "ef.6-gh.10", content: "second\n", action: "replace" },
    ]);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ops.length, 2);
  });

  it("accepts replace range followed by insert_after on same end line", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      { ref: `1-10:${ck}`, range: "ab.1-cd.5", content: "replacement\n", action: "replace" },
      { ref: `1-10:${ck}`, range: "+ef.6", content: "inserted after\n", action: "insert_after" },
    ]);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ops.length, 2);
  });

  // ── Insert_after inside replace range ────────────────────────────────────

  it("rejects insert_after inside a replace range", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      { ref: `1-20:${ck}`, range: "ab.5-cd.15", content: "replacement block\n", action: "replace" },
      { ref: `1-20:${ck}`, range: "+yz.10", content: "inserted inside\n", action: "insert_after" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("falls inside replace range")));
  });

  // ── StreamEditOp construction ────────────────────────────────────────────

  it("builds StreamEditOp with correct fields for replace", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      { ref: `1-5:${ck}`, range: "ab.1-cd.5", content: "new content\n", action: "replace" },
    ]);
    assert.strictEqual(result.valid, true);
    const op = result.ops[0];
    assert.strictEqual(op.startLine, 1);
    assert.strictEqual(op.endLine, 5);
    assert.strictEqual(op.insertAfter, false);
    assert.strictEqual(op.content, "new content\n");
    assert.strictEqual(op.refStartLine, 1);
    assert.strictEqual(op.refEndLine, 5);
    assert.strictEqual(op.refChecksum, ck);
    assert.strictEqual(op.startHash, "ab");
    assert.strictEqual(op.endHash, "cd");
  });

  it("builds StreamEditOp with correct fields for insert_after", () => {
    const lines = ["line1"];
    const ck = computeChecksumLetters(lines);
    const result = validateEdits([
      { ref: `1-1:${ck}`, range: "+ab.1", content: "inserted\n", action: "insert_after" },
    ]);
    assert.strictEqual(result.valid, true);
    const op = result.ops[0];
    assert.strictEqual(op.startLine, 1);
    assert.strictEqual(op.endLine, 1);
    assert.strictEqual(op.insertAfter, true);
    assert.strictEqual(op.content, "inserted\n");
    assert.strictEqual(op.startHash, "ab");
    assert.strictEqual(op.endHash, "ab");
  });

  it("handles bare number ref (BARE_LINE_HASH → undefined hash)", () => {
    // Use a ref that actually covers line 42: compute the checksum for line 42's content
    const refLines = ["content at line 42"];
    let acc = FNV_OFFSET_BASIS;
    for (const ln of refLines) acc = foldHash(acc, fnv1aHash(ln));
    const ck = checksumToLetters(acc);
    const result = validateEdits([
      { ref: `42-42:${ck}`, range: "42", content: "bare number replace\n", action: "replace" },
    ]);
    assert.strictEqual(result.valid, true);
    const op = result.ops[0];
    assert.strictEqual(op.startLine, 42);
    assert.strictEqual(op.startHash, undefined);
    assert.strictEqual(op.endHash, undefined);
  });

  it("validates multiple edits and reports all errors", () => {
    const result = validateEdits([
      {},
      { ref: "", range: "ab.5", content: "hi", action: "replace" },
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });
});

// ==============================================================================
// verifyChecksum
// ==============================================================================
describe("verifyChecksum", () => {
  it("passes for matching content and ref", () => {
    const lines = ["hello", "world"];
    const ck = computeChecksumLetters(lines);
    const result = verifyChecksum(lines, `1-2:${ck}`);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.computedChecksum, ck);
  });

  it("passes for single line", () => {
    const lines = ["just one line"];
    const ck = computeChecksumLetters(lines);
    const result = verifyChecksum(lines, `1-1:${ck}`);
    assert.strictEqual(result.valid, true);
  });

  it("passes with hash.line format ref", () => {
    const lines = ["hello", "world"];
    const ck = computeChecksumLetters(lines);
    const result = verifyChecksum(lines, `ab.1-cd.2:${ck}`);
    assert.strictEqual(result.valid, true);
  });

  it("passes with 'checksum: ' prefix", () => {
    const lines = ["hello", "world"];
    const ck = computeChecksumLetters(lines);
    const result = verifyChecksum(lines, `checksum: 1-2:${ck}`);
    assert.strictEqual(result.valid, true);
  });

  it("passes with 'ref: ' prefix", () => {
    const lines = ["hello", "world"];
    const ck = computeChecksumLetters(lines);
    const result = verifyChecksum(lines, `ref: 1-2:${ck}`);
    assert.strictEqual(result.valid, true);
  });

  it("fails for checksum mismatch", () => {
    const lines = ["hello", "world"];
    const result = verifyChecksum(lines, "1-2:zzzzzz");
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("Checksum mismatch"));
    assert.ok(result.error.includes('expected "zzzzzz"'));
    assert.strictEqual(typeof result.computedChecksum, "string");
  });

  it("detects empty file sentinel with no lines", () => {
    const result = verifyChecksum([], EMPTY_FILE_CHECKSUM);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.computedChecksum, "aaaaaa");
  });

  it("rejects empty file sentinel when lines are provided", () => {
    const result = verifyChecksum(["unexpected content"], EMPTY_FILE_CHECKSUM);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("empty file"));
    assert.ok(result.error.includes("has gained content"));
  });

  it("detects truncated content (fewer lines than ref expects)", () => {
    const lines = Array.from({ length: 3 }, (_, i) => `line${i + 1}`);
    const ck = computeChecksumLetters(lines);
    // Ref expects 10 lines but only 3 provided
    const refLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const refCk = computeChecksumLetters(refLines);
    const result = verifyChecksum(lines, `1-10:${refCk}`);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("Truncated content"));
    assert.ok(result.error.includes("expects 10 lines"));
    assert.ok(result.error.includes("only 3 line(s)"));
  });

  it("rejects invalid ref format", () => {
    const result = verifyChecksum(["hello"], "not-a-ref");
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("Invalid ref format"));
  });

  it("handles many lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i}-content`);
    const ck = computeChecksumLetters(lines);
    const result = verifyChecksum(lines, `1-100:${ck}`);
    assert.strictEqual(result.valid, true);
  });

  it("detects single-line content change", () => {
    // One line with "hello"
    const originalLines = ["hello"];
    const ck = computeChecksumLetters(originalLines);
    // Modified content
    const modifiedLines = ["hello!"];
    const result = verifyChecksum(modifiedLines, `1-1:${ck}`);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("Checksum mismatch"));
  });

  it("detects empty line vs line with content", () => {
    const emptyLines = [""];
    const ck = computeChecksumLetters(emptyLines);
    const result = verifyChecksum(["content"], `1-1:${ck}`);
    assert.strictEqual(result.valid, false);
  });

  it("handles lines with special characters", () => {
    const lines = ["héllo wörld", "foo\tbar", "emoji 🚀 test", "  spaced  "];
    const ck = computeChecksumLetters(lines);
    const result = verifyChecksum(lines, `1-4:${ck}`);
    assert.strictEqual(result.valid, true);
  });
});

// ==============================================================================
// verifyBoundaryHash
// ==============================================================================
describe("verifyBoundaryHash", () => {
  it("passes when hashes match", () => {
    const content = "Hello world";
    const hash = hashToLetters(fnv1aHash(content));
    const result = verifyBoundaryHash(content, hash, 5);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.actualHash, hash);
  });

  it("fails when hashes mismatch", () => {
    const content = "Hello world";
    const result = verifyBoundaryHash(content, "zz", 5);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("Boundary hash mismatch at line 5"));
    assert.ok(result.error.includes('expected hash tag "zz"'));
    assert.strictEqual(typeof result.actualHash, "string");
  });

  it("includes actionable remediation in error message", () => {
    const content = "Some content";
    const result = verifyBoundaryHash(content, "xx", 10);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("trueline_read"));
  });

  it("handles empty string content", () => {
    const content = "";
    const hash = hashToLetters(fnv1aHash(""));
    const result = verifyBoundaryHash(content, hash, 1);
    assert.strictEqual(result.valid, true);
  });

  it("handles long content", () => {
    const content = "A".repeat(1000);
    const hash = hashToLetters(fnv1aHash(content));
    const result = verifyBoundaryHash(content, hash, 100);
    assert.strictEqual(result.valid, true);
  });

  it("handles line number 0 (prepend context)", () => {
    const content = "Prepended content";
    const hash = hashToLetters(fnv1aHash(content));
    const result = verifyBoundaryHash(content, hash, 0);
    assert.strictEqual(result.valid, true);
  });

  it("differentiates close hash tags", () => {
    // Two different strings that produce different hashes
    const content1 = "hello";
    const content2 = "hallo";
    const hash1 = hashToLetters(fnv1aHash(content1));
    const result = verifyBoundaryHash(content2, hash1, 1);
    assert.strictEqual(result.valid, false);
  });

  it("computes actualHash on failure", () => {
    const result = verifyBoundaryHash("some content", "aa", 1);
    assert.strictEqual(result.valid, false);
    assert.ok(typeof result.actualHash === "string");
    assert.strictEqual(result.actualHash.length, 2);
  });
});

// ==============================================================================
// Integration: Cross-module consistency
// ==============================================================================
describe("Integration: verify function consistency", () => {
  it("verifyChecksum agrees with hash module's checksum computation", () => {
    const lines = ["first line", "second line", "third line"];
    // Compute checksum using hash module directly
    const ck = computeChecksumLetters(lines);
    // Verify via verifyChecksum
    const result = verifyChecksum(lines, `1-3:${ck}`);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.computedChecksum, ck);
  });

  it("verifyBoundaryHash agrees with hash module's hashToLetters", () => {
    const content = "some boundary content";
    const expectedHash = hashToLetters(fnv1aHash(content));
    const result = verifyBoundaryHash(content, expectedHash, 1);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.actualHash, expectedHash);
  });

  it("validateEdits and verifyChecksum agree on ref value", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `data-${i}`);
    const ck = computeChecksumLetters(lines);
    // validateEdits should accept this ref
    const validation = validateEdits([
      { ref: `1-10:${ck}`, range: "ab.3-cd.7", content: "replacement\n", action: "replace" },
    ]);
    assert.strictEqual(validation.valid, true);
    // verifyChecksum should also pass for the same ref
    const checksumCheck = verifyChecksum(lines, `1-10:${ck}`);
    assert.strictEqual(checksumCheck.valid, true);
  });
});
