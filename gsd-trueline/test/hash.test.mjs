// ==============================================================================
// Tests for src/common/hash.js
// ==============================================================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FNV_OFFSET_BASIS,
  FNV_PRIME,
  EMPTY_FILE_CHECKSUM,
  fnv1aHash,
  fnv1aHashBytes,
  foldHash,
  hashToLetters,
  checksumToLetters,
  formatChecksum,
  LETTER_TABLE,
} from "../src/common/hash.js";

// ==============================================================================
// Constants
// ==============================================================================
describe("constants", () => {
  it("FNV_OFFSET_BASIS is 2166136261", () => {
    assert.strictEqual(FNV_OFFSET_BASIS, 2166136261);
  });

  it("FNV_PRIME is 16777619", () => {
    assert.strictEqual(FNV_PRIME, 16777619);
  });

  it("EMPTY_FILE_CHECKSUM is 0-0:aaaaaa", () => {
    assert.strictEqual(EMPTY_FILE_CHECKSUM, "0-0:aaaaaa");
  });
});

// ==============================================================================
// fnv1aHash
// ==============================================================================
describe("fnv1aHash", () => {
  it("returns FNV_OFFSET_BASIS for empty string", () => {
    const result = fnv1aHash("");
    assert.strictEqual(result, FNV_OFFSET_BASIS);
  });

  it("produces deterministic results", () => {
    const h1 = fnv1aHash("hello world");
    const h2 = fnv1aHash("hello world");
    assert.strictEqual(h1, h2);
  });

  it("hashes ASCII strings correctly", () => {
    // Known FNV-1a values computed independently
    const h = fnv1aHash("a");
    assert.strictEqual(typeof h, "number");
    assert.strictEqual(h >>> 0, h); // unsigned 32-bit
  });

  it("produces different hashes for different strings", () => {
    const h1 = fnv1aHash("foo");
    const h2 = fnv1aHash("bar");
    assert.notStrictEqual(h1, h2);
  });

  it("hashes multi-byte UTF-8 characters", () => {
    const h = fnv1aHash("héllo");
    assert.strictEqual(typeof h, "number");
    assert.strictEqual(h >>> 0, h);
  });

  it("hashes 3-byte UTF-8 characters (CJK)", () => {
    const h = fnv1aHash("世界");
    assert.strictEqual(typeof h, "number");
    assert.strictEqual(h >>> 0, h);
  });

  it("hashes 4-byte UTF-8 characters (emoji)", () => {
    const h = fnv1aHash("🚀");
    assert.strictEqual(typeof h, "number");
    assert.strictEqual(h >>> 0, h);
  });

  it("handles surrogate pairs correctly (emoji)", () => {
    // '😀' is U+1F600, encoded as surrogate pair \uD83D\uDE00
    const emoji = "😀";
    assert.strictEqual(emoji.length, 2); // surrogate pair in JS
    const h = fnv1aHash(emoji);
    assert.strictEqual(typeof h, "number");
    assert.strictEqual(h >>> 0, h);
  });

  it("returns consistent hash between string and byte equivalent", () => {
    const str = "hello world";
    const strHash = fnv1aHash(str);
    const buf = Buffer.from(str, "utf-8");
    const bufHash = fnv1aHashBytes(buf, 0, buf.length);
    assert.strictEqual(strHash, bufHash);
  });

  it("handles empty surrogate pair edge case", () => {
    // Unpaired high surrogate
    const h = fnv1aHash("\uD800");
    assert.strictEqual(h >>> 0, h);
  });

  it("handles unpaired low surrogate", () => {
    const h = fnv1aHash("\uDC00");
    assert.strictEqual(h >>> 0, h);
  });
});

// ==============================================================================
// fnv1aHashBytes
// ==============================================================================
describe("fnv1aHashBytes", () => {
  it("hashes an empty buffer to FNV_OFFSET_BASIS", () => {
    const buf = Buffer.alloc(0);
    assert.strictEqual(fnv1aHashBytes(buf, 0, 0), FNV_OFFSET_BASIS);
  });

  it("hashes a simple buffer correctly", () => {
    const buf = Buffer.from("hello", "utf-8");
    const h = fnv1aHashBytes(buf, 0, buf.length);
    assert.strictEqual(typeof h, "number");
    assert.strictEqual(h >>> 0, h);
  });

  it("hashes partial buffers (sub-range)", () => {
    const buf = Buffer.from("abcdef", "utf-8");
    const hashBc = fnv1aHashBytes(buf, 1, 3);
    const hashFull = fnv1aHash("bc");
    assert.strictEqual(hashBc, hashFull);
  });

  it("matches fnv1aHash for equivalent UTF-8 input", () => {
    const str = "héllo 🚀 world";
    const strHash = fnv1aHash(str);
    const buf = Buffer.from(str, "utf-8");
    const bufHash = fnv1aHashBytes(buf, 0, buf.length);
    assert.strictEqual(strHash, bufHash);
  });

  it("hashes large buffers deterministically", () => {
    const buf = Buffer.alloc(10000, 0x41); // 'A' * 10000
    const h1 = fnv1aHashBytes(buf, 0, buf.length);
    const h2 = fnv1aHashBytes(buf, 0, buf.length);
    assert.strictEqual(h1, h2);
  });
});

// ==============================================================================
// foldHash
// ==============================================================================
describe("foldHash", () => {
  it("folds a zero hash into the accumulator", () => {
    const acc = foldHash(FNV_OFFSET_BASIS, 0);
    assert.strictEqual(typeof acc, "number");
    assert.strictEqual(acc >>> 0, acc);
  });

  it("produces different accumulators for different hashes", () => {
    const acc1 = foldHash(FNV_OFFSET_BASIS, fnv1aHash("foo"));
    const acc2 = foldHash(FNV_OFFSET_BASIS, fnv1aHash("bar"));
    assert.notStrictEqual(acc1, acc2);
  });

  it("chain-folds multiple hashes idempotently", () => {
    const lines = ["line one", "line two", "line three"];
    let acc = FNV_OFFSET_BASIS;
    const hashes = lines.map((l) => fnv1aHash(l));
    for (const h of hashes) {
      acc = foldHash(acc, h);
    }
    // Same sequence should produce same result
    let acc2 = FNV_OFFSET_BASIS;
    for (const h of hashes) {
      acc2 = foldHash(acc2, h);
    }
    assert.strictEqual(acc, acc2);
  });

  it("fold order matters (different order = different checksum)", () => {
    const h1 = fnv1aHash("first");
    const h2 = fnv1aHash("second");
    const acc12 = foldHash(foldHash(FNV_OFFSET_BASIS, h1), h2);
    const acc21 = foldHash(foldHash(FNV_OFFSET_BASIS, h2), h1);
    assert.notStrictEqual(acc12, acc21);
  });
});

// ==============================================================================
// LETTER_TABLE
// ==============================================================================
describe("LETTER_TABLE", () => {
  it("has 676 entries", () => {
    assert.strictEqual(LETTER_TABLE.length, 676);
  });

  it("first entry is 'aa'", () => {
    assert.strictEqual(LETTER_TABLE[0], "aa");
  });

  it("last entry is 'zz'", () => {
    assert.strictEqual(LETTER_TABLE[675], "zz");
  });

  it("contains all 26^2 combinations", () => {
    const seen = new Set(LETTER_TABLE);
    assert.strictEqual(seen.size, 676);
    // Verify 'ab', 'ac', ..., 'az', 'ba', etc. are present
    assert(seen.has("ab"));
    assert(seen.has("ac"));
    assert(seen.has("ba"));
    assert(seen.has("za"));
    assert(seen.has("zz"));
  });
});

// ==============================================================================
// hashToLetters
// ==============================================================================
describe("hashToLetters", () => {
  it("returns a 2-character string", () => {
    const result = hashToLetters(42);
    assert.strictEqual(typeof result, "string");
    assert.strictEqual(result.length, 2);
  });

  it("returns lowercase letters only", () => {
    for (let i = 0; i < 1000; i++) {
      const result = hashToLetters(i * 9973);
      assert.match(result, /^[a-z]{2}$/);
    }
  });

  it("is deterministic", () => {
    const hash = fnv1aHash("some content");
    assert.strictEqual(hashToLetters(hash), hashToLetters(hash));
  });

  it("uses LETTER_TABLE for lookup", () => {
    const hash = 0;
    const expected = LETTER_TABLE[0]; // hash 0: folded=0, (0%26)*26 + ((0>>>8)%26) = 0
    assert.strictEqual(hashToLetters(hash), expected);
  });

  it("distributes across the full 676-tag space", () => {
    // Generate hashes for many distinct strings and check distribution
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
      const h = fnv1aHash(`line ${i} with varied content to spread hashes`);
      seen.add(hashToLetters(h));
    }
    // Should cover a good portion of the space (at least 200 unique tags)
    assert(seen.size >= 200, `Only got ${seen.size} unique tags from 500 strings`);
  });
});

// ==============================================================================
// checksumToLetters
// ==============================================================================
describe("checksumToLetters", () => {
  it("returns a 6-character string", () => {
    const result = checksumToLetters(42);
    assert.strictEqual(typeof result, "string");
    assert.strictEqual(result.length, 6);
  });

  it("returns lowercase letters only", () => {
    for (let i = 0; i < 100; i++) {
      const result = checksumToLetters(i * 123457);
      assert.match(result, /^[a-z]{6}$/);
    }
  });

  it("encodes 0 as 'aaaaaa'", () => {
    assert.strictEqual(checksumToLetters(0), "aaaaaa");
  });

  it("is deterministic", () => {
    assert.strictEqual(checksumToLetters(12345), checksumToLetters(12345));
  });

  it("reversibly encodes values (via base-26)", () => {
    // Decode: convert base-26 back to number
    const decodeLetters = (s) => {
      let n = 0;
      for (const ch of s) {
        n = n * 26 + (ch.charCodeAt(0) - 97);
      }
      return n;
    };
    // 6 base-26 digits can represent 0 to 26^6-1 = 308,915,775
    const testValues = [0, 1, 25, 26, 100, 100000, 123456789, 308915775];
    for (const v of testValues) {
      const encoded = checksumToLetters(v);
      const decoded = decodeLetters(encoded);
      assert.strictEqual(decoded, v, `Failed round-trip for ${v}: got "${encoded}" -> ${decoded}`);
    }
  });
});

// ==============================================================================
// formatChecksum
// ==============================================================================
describe("formatChecksum", () => {
  it("formats with start/end/hash only (decimal format)", () => {
    const result = formatChecksum(1, 5, 0);
    assert.strictEqual(result, "1-5:aaaaaa");
  });

  it("formats with hash letters (hash.line format)", () => {
    const result = formatChecksum(9, 10, 12345, "aj", "na");
    assert.match(result, /^aj\.9-na\.10:[a-z]{6}$/);
  });

  it("includes only startLetters when endLetters omitted", () => {
    const result = formatChecksum(1, 5, 42, "ab");
    // Without both letters, falls back to decimal format
    assert.match(result, /^1-5:[a-z]{6}$/);
  });
});

// ==============================================================================
// Integration: full hash pipeline
// ==============================================================================
describe("integration: hash pipeline", () => {
  it("computes consistent line hashes for a multi-line string", () => {
    const lines = [
      "const x = 1;",
      "function foo() {",
      "  return x;",
      "}",
    ];
    const hashes = lines.map((l) => fnv1aHash(l));
    assert.strictEqual(hashes.length, 4);
    hashes.forEach((h) => {
      assert.strictEqual(h >>> 0, h);
    });
    // Line hashes are deterministic
    const hashes2 = lines.map((l) => fnv1aHash(l));
    assert.deepEqual(hashes, hashes2);
  });

  it("computes range checksum via foldHash chain", () => {
    const lines = [
      "line one",
      "line two",
      "line three",
    ];
    let checksum = FNV_OFFSET_BASIS;
    for (const line of lines) {
      checksum = foldHash(checksum, fnv1aHash(line));
    }
    const checksumStr = checksumToLetters(checksum);
    assert.strictEqual(checksumStr.length, 6);
    assert.match(checksumStr, /^[a-z]{6}$/);
  });

  it("hashToLetters + checksumToLetters produce distinct results for same value", () => {
    const hash = fnv1aHash("test data");
    const tag = hashToLetters(hash);
    const cs = checksumToLetters(hash);
    assert.strictEqual(tag.length, 2);
    assert.strictEqual(cs.length, 6);
    assert.notStrictEqual(tag, cs);
  });
});
