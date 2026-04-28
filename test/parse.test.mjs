// ==============================================================================
// Tests for src/common/parse.js
// ==============================================================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BARE_LINE_HASH,
  parseHashLine,
  parseRange,
  parseChecksum,
  parseInlineRef,
  parseRanges,
  parseFilePathWithRanges,
} from "../src/common/parse.js";

// ==============================================================================
// Constants
// ==============================================================================
describe("constants", () => {
  it("BARE_LINE_HASH is '??'", () => {
    assert.strictEqual(BARE_LINE_HASH, "??");
  });
});

// ==============================================================================
// parseHashLine
// ==============================================================================
describe("parseHashLine", () => {
  it('parses "ab.12" correctly', () => {
    const result = parseHashLine("ab.12");
    assert.deepEqual(result, { line: 12, hash: "ab" });
  });

  it('parses bare "0" as insert-at-start', () => {
    const result = parseHashLine("0");
    assert.deepEqual(result, { line: 0, hash: "" });
  });

  it('parses bare non-zero number with sentinel hash', () => {
    const result = parseHashLine("42");
    assert.deepEqual(result, { line: 42, hash: BARE_LINE_HASH });
  });

  it("throws on invalid format (no dot, not a number)", () => {
    assert.throws(() => parseHashLine("abc"), /Invalid hash\.line/);
  });

  it("throws on line 0 with hash prefix", () => {
    assert.throws(() => parseHashLine("ab.0"), /line 0 must use bare "0"/);
  });

  it("throws on non-integer line number", () => {
    assert.throws(() => parseHashLine("ab.12.5"), /must be a non-negative integer/);
  });

  it("returns sentinel hash for wrong hash format but valid line", () => {
    const result = parseHashLine("abc.12");
    assert.strictEqual(result.line, 12);
    assert.strictEqual(result.hash, BARE_LINE_HASH);
  });

  it("throws on empty hash with dot and valid line", () => {
    assert.throws(() => parseHashLine(".12"), /expected format/);
  });

  it("handles 'zz.1' (high hash letters)", () => {
    const result = parseHashLine("zz.1");
    assert.deepEqual(result, { line: 1, hash: "zz" });
  });
});

// ==============================================================================
// parseRange
// ==============================================================================
describe("parseRange", () => {
  it('parses "gh.12-yz.21" as explicit start-end range', () => {
    const result = parseRange("gh.12-yz.21");
    assert.strictEqual(result.start.line, 12);
    assert.strictEqual(result.start.hash, "gh");
    assert.strictEqual(result.end.line, 21);
    assert.strictEqual(result.end.hash, "yz");
    assert.strictEqual(result.insertAfter, false);
  });

  it('parses "ab.5" as single-line shorthand', () => {
    const result = parseRange("ab.5");
    assert.strictEqual(result.start.line, 5);
    assert.strictEqual(result.start.hash, "ab");
    assert.strictEqual(result.end.line, 5);
    assert.strictEqual(result.end.hash, "ab");
    assert.strictEqual(result.insertAfter, false);
  });

  it('parses "+ab.5" as insert-after', () => {
    const result = parseRange("+ab.5");
    assert.strictEqual(result.start.line, 5);
    assert.strictEqual(result.start.hash, "ab");
    assert.strictEqual(result.insertAfter, true);
  });

  it("throws on insert-after with a range (dash present)", () => {
    assert.throws(() => parseRange("+ab.5-cd.10"), /insert-after.*requires a single-line target/);
  });

  it("throws on start > end", () => {
    assert.throws(() => parseRange("yz.21-gh.12"), /start line.*must be ≤ end line/);
  });

  it("handles same start and end with explicit range", () => {
    const result = parseRange("ab.5-ab.5");
    assert.strictEqual(result.start.line, 5);
    assert.strictEqual(result.end.line, 5);
    assert.strictEqual(result.insertAfter, false);
  });

  it("returns sentinel hash for wrong hash format in range", () => {
    const result = parseRange("invalid.5-ab.10");
    assert.strictEqual(result.start.line, 5);
    assert.strictEqual(result.start.hash, BARE_LINE_HASH);
    assert.strictEqual(result.end.line, 10);
    assert.strictEqual(result.end.hash, "ab");
  });
});

// ==============================================================================
// parseChecksum
// ==============================================================================
describe("parseChecksum", () => {
  it('parses decimal format "9-10:abcdef"', () => {
    const result = parseChecksum("9-10:abcdef");
    assert.deepEqual(result, { startLine: 9, endLine: 10, hash: "abcdef" });
  });

  it('parses hash.line format "aj.9-na.10:abcdef"', () => {
    const result = parseChecksum("aj.9-na.10:abcdef");
    assert.deepEqual(result, { startLine: 9, endLine: 10, hash: "abcdef" });
  });

  it('parses single-line "5:abcdef"', () => {
    const result = parseChecksum("5:abcdef");
    assert.deepEqual(result, { startLine: 5, endLine: 5, hash: "abcdef" });
  });

  it('parses with "checksum: " prefix stripped', () => {
    const result = parseChecksum("checksum: 9-10:abcdef");
    assert.deepEqual(result, { startLine: 9, endLine: 10, hash: "abcdef" });
  });

  it('parses with "ref: " prefix stripped', () => {
    const result = parseChecksum("ref: aj.9-na.10:abcdef");
    assert.deepEqual(result, { startLine: 9, endLine: 10, hash: "abcdef" });
  });

  it("parses the empty-file sentinel", () => {
    const result = parseChecksum("0-0:aaaaaa");
    assert.deepEqual(result, { startLine: 0, endLine: 0, hash: "aaaaaa" });
  });

  it("normalizes hash to lowercase", () => {
    const result = parseChecksum("9-10:ABCDEF");
    assert.strictEqual(result.hash, "abcdef");
  });

  it("throws on missing colon separator", () => {
    assert.throws(() => parseChecksum("9-10"), /expected format.*startLine-endLine:letters/);
  });

  it("throws on invalid hash (not 6 letters)", () => {
    assert.throws(() => parseChecksum("9-10:abc"), /hash must be 6 lowercase letters/);
  });

  it("throws on startLine 0 with endLine > 0", () => {
    assert.throws(() => parseChecksum("0-5:abcdef"), /startLine 0 requires endLine 0/);
  });

  it("throws on start > end", () => {
    assert.throws(() => parseChecksum("10-5:abcdef"), /must be ≤ end/);
  });

  it("throws on 0-0 with non-aaaaaa hash", () => {
    assert.throws(() => parseChecksum("0-0:zzzzzz"), /empty-file sentinel must have hash aaaaaa/);
  });

  it("throws on two-letter hash prefix too short", () => {
    assert.throws(() => parseChecksum("a.9-10:abcdef"), /hash prefix must be 2 lowercase letters/);
  });

  it("throws on non-decimal line in hash.line format", () => {
    assert.throws(() => parseChecksum("aj.abc-na.10:abcdef"), /must be a decimal integer/);
  });

  it("throws on non-decimal bare line", () => {
    assert.throws(() => parseChecksum("abc-10:abcdef"), /must be a decimal integer/);
  });

  it("parses mixed format (decimal start, hash.line end)", () => {
    const result = parseChecksum("9-na.10:abcdef");
    assert.deepEqual(result, { startLine: 9, endLine: 10, hash: "abcdef" });
  });
});

// ==============================================================================
// parseInlineRef
// ==============================================================================
describe("parseInlineRef", () => {
  it("delegates to parseChecksum", () => {
    const result = parseInlineRef("aj.9-na.10:abcdef");
    assert.deepEqual(result, { startLine: 9, endLine: 10, hash: "abcdef" });
  });

  it("handles decimal format via delegation", () => {
    const result = parseInlineRef("9-10:abcdef");
    assert.deepEqual(result, { startLine: 9, endLine: 10, hash: "abcdef" });
  });
});

// ==============================================================================
// parseRanges
// ==============================================================================
describe("parseRanges", () => {
  it("returns whole-file range for undefined input", () => {
    const result = parseRanges(undefined);
    assert.deepEqual(result, [{ start: 1, end: Infinity }]);
  });

  it("returns whole-file range for empty array", () => {
    const result = parseRanges([]);
    assert.deepEqual(result, [{ start: 1, end: Infinity }]);
  });

  it('parses "10-20" as explicit range', () => {
    const result = parseRanges(["10-20"]);
    assert.deepEqual(result, [{ start: 10, end: 20 }]);
  });

  it('parses "10" as single line', () => {
    const result = parseRanges(["10"]);
    assert.deepEqual(result, [{ start: 10, end: 10 }]);
  });

  it('parses "10-" as to-EOF', () => {
    const result = parseRanges(["10-"]);
    assert.deepEqual(result, [{ start: 10, end: Infinity }]);
  });

  it('parses "-20" as from-start', () => {
    const result = parseRanges(["-20"]);
    assert.deepEqual(result, [{ start: 1, end: 20 }]);
  });

  it("sorts ranges by start line", () => {
    const result = parseRanges(["30-40", "10-20"]);
    assert.strictEqual(result[0].start, 10);
    assert.strictEqual(result[1].start, 30);
  });

  it("merges overlapping ranges", () => {
    const result = parseRanges(["10-20", "15-25"]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].start, 10);
    assert.strictEqual(result[0].end, 25);
  });

  it("merges adjacent ranges (end+1 === next start)", () => {
    const result = parseRanges(["10-20", "21-30"]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].start, 10);
    assert.strictEqual(result[0].end, 30);
  });

  it("keeps non-overlapping ranges separate", () => {
    const result = parseRanges(["10-20", "30-40"]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].start, 10);
    assert.strictEqual(result[0].end, 20);
    assert.strictEqual(result[1].start, 30);
    assert.strictEqual(result[1].end, 40);
  });

  it("merges multiple overlapping ranges into one", () => {
    const result = parseRanges(["5-10", "8-12", "15-20", "18-22"]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].start, 5);
    assert.strictEqual(result[0].end, 12);
    assert.strictEqual(result[1].start, 15);
    assert.strictEqual(result[1].end, 22);
  });

  it("throws on negative start", () => {
    // "-5-10" is parsed as dashIdx=0 (start=1, end=NaN)
    assert.throws(() => parseRanges(["-5-10"]), /end must be a positive integer/);
  });

  it("throws on start > end", () => {
    assert.throws(() => parseRanges(["20-10"]), /start.*must be <= end/);
  });

  it("throws on non-integer values", () => {
    assert.throws(() => parseRanges(["abc"]), /start must be a positive integer/);
  });

  it("merges Infinity ranges correctly", () => {
    const result = parseRanges(["10-", "20-30"]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].start, 10);
    assert.strictEqual(result[0].end, Infinity);
  });

  it("handles unsorted input", () => {
    const result = parseRanges(["50-60", "10-20", "30-40"]);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].start, 10);
    assert.strictEqual(result[1].start, 30);
    assert.strictEqual(result[2].start, 50);
  });
});

// ==============================================================================
// parseFilePathWithRanges
// ==============================================================================
describe("parseFilePathWithRanges", () => {
  it('parses "src/foo.ts" without ranges', () => {
    const result = parseFilePathWithRanges("src/foo.ts");
    assert.strictEqual(result.path, "src/foo.ts");
    assert.strictEqual(result.rangeSpecs, undefined);
  });

  it('parses "src/foo.ts:10-25" with inline range', () => {
    const result = parseFilePathWithRanges("src/foo.ts:10-25");
    assert.strictEqual(result.path, "src/foo.ts");
    assert.deepEqual(result.rangeSpecs, ["10-25"]);
  });

  it('parses "src/foo.ts:1-20,200-220" with multiple ranges', () => {
    const result = parseFilePathWithRanges("src/foo.ts:1-20,200-220");
    assert.strictEqual(result.path, "src/foo.ts");
    assert.deepEqual(result.rangeSpecs, ["1-20", "200-220"]);
  });

  it('parses "src/foo.ts:10" as single line range', () => {
    const result = parseFilePathWithRanges("src/foo.ts:10");
    assert.strictEqual(result.path, "src/foo.ts");
    assert.deepEqual(result.rangeSpecs, ["10"]);
  });

  it('parses "src/foo.ts:10-" as to-EOF range', () => {
    const result = parseFilePathWithRanges("src/foo.ts:10-");
    assert.strictEqual(result.path, "src/foo.ts");
    assert.deepEqual(result.rangeSpecs, ["10-"]);
  });

  it('avoids splitting on "C:" drive letter', () => {
    const result = parseFilePathWithRanges("C:\\project\\file.ts:10-25");
    // Should find the last colon followed by digit AFTER the drive letter
    assert.strictEqual(result.path, "C:\\project\\file.ts");
    assert.deepEqual(result.rangeSpecs, ["10-25"]);
  });

  it("handles file with colon in name (not at end)", () => {
    const result = parseFilePathWithRanges("src/file:name.txt");
    assert.strictEqual(result.path, "src/file:name.txt");
    assert.strictEqual(result.rangeSpecs, undefined);
  });

  it("handles empty range string after colon", () => {
    const result = parseFilePathWithRanges("src/foo.ts:");
    assert.strictEqual(result.path, "src/foo.ts:");
    assert.strictEqual(result.rangeSpecs, undefined);
  });

  it("handles absolute paths with ranges", () => {
    const result = parseFilePathWithRanges("/home/user/project/src/foo.ts:10-25");
    assert.strictEqual(result.path, "/home/user/project/src/foo.ts");
    assert.deepEqual(result.rangeSpecs, ["10-25"]);
  });

  it("trims whitespace around ranges", () => {
    const result = parseFilePathWithRanges("src/foo.ts:10-20, 30-40");
    assert.deepEqual(result.rangeSpecs, ["10-20", "30-40"]);
  });
});
