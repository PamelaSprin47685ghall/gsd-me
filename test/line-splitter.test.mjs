// ==============================================================================
// Tests for src/read/line-splitter.js
// ==============================================================================
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink, mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  splitChunks,
  splitLines,
  LF_BUF,
  CRLF_BUF,
  CR_BUF,
  EMPTY_BUF,
} from "../src/read/line-splitter.js";

// ==============================================================================
// Constants
// ==============================================================================
describe("constants", () => {
  it("LF_BUF is a buffer containing \\n", () => {
    assert.ok(Buffer.isBuffer(LF_BUF));
    assert.strictEqual(LF_BUF.length, 1);
    assert.strictEqual(LF_BUF[0], 0x0a);
  });

  it("CRLF_BUF is a buffer containing \\r\\n", () => {
    assert.ok(Buffer.isBuffer(CRLF_BUF));
    assert.strictEqual(CRLF_BUF.length, 2);
    assert.strictEqual(CRLF_BUF[0], 0x0d);
    assert.strictEqual(CRLF_BUF[1], 0x0a);
  });

  it("CR_BUF is a buffer containing \\r", () => {
    assert.ok(Buffer.isBuffer(CR_BUF));
    assert.strictEqual(CR_BUF.length, 1);
    assert.strictEqual(CR_BUF[0], 0x0d);
  });

  it("EMPTY_BUF is a zero-length buffer", () => {
    assert.ok(Buffer.isBuffer(EMPTY_BUF));
    assert.strictEqual(EMPTY_BUF.length, 0);
  });
});

// ==============================================================================
// Helper: collect all lines from splitChunks into an array
// ==============================================================================
async function collectLines(chunks, opts) {
  const lines = [];
  for await (const line of splitChunks(chunks, opts)) {
    lines.push(line);
  }
  return lines;
}

async function collectLinesFrom(gen) {
  const lines = [];
  for await (const line of gen) {
    lines.push(line);
  }
  return lines;
}

function chunks(...buffers) {
  return buffers;
}

// ==============================================================================
// splitChunks — basic line endings
// ==============================================================================
describe("splitChunks — basic line endings", () => {
  it("splits LF-terminated lines", async () => {
    const input = Buffer.from("line1\nline2\nline3\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[1].lineBytes.toString(), "line2");
    assert.strictEqual(lines[2].lineBytes.toString(), "line3");
    assert.strictEqual(lines[0].lineNumber, 1);
    assert.strictEqual(lines[1].lineNumber, 2);
    assert.strictEqual(lines[2].lineNumber, 3);
    assert.strictEqual(lines[0].eolBytes, LF_BUF);
    assert.strictEqual(lines[1].eolBytes, LF_BUF);
    assert.strictEqual(lines[2].eolBytes, LF_BUF);
  });

  it("splits CRLF-terminated lines", async () => {
    const input = Buffer.from("line1\r\nline2\r\nline3\r\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[1].lineBytes.toString(), "line2");
    assert.strictEqual(lines[2].lineBytes.toString(), "line3");
    assert.strictEqual(lines[0].eolBytes, CRLF_BUF);
  });

  it("splits CR-terminated lines (old Mac style)", async () => {
    const input = Buffer.from("line1\rline2\rline3\r");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[1].lineBytes.toString(), "line2");
    assert.strictEqual(lines[2].lineBytes.toString(), "line3");
    assert.strictEqual(lines[0].eolBytes, CR_BUF);
  });

  it("handles mixed line endings", async () => {
    const input = Buffer.from("line1\nline2\r\nline3\r");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[0].eolBytes, LF_BUF);
    assert.strictEqual(lines[1].lineBytes.toString(), "line2");
    assert.strictEqual(lines[1].eolBytes, CRLF_BUF);
    assert.strictEqual(lines[2].lineBytes.toString(), "line3");
    assert.strictEqual(lines[2].eolBytes, CR_BUF);
  });

  it("handles empty lines in the middle", async () => {
    const input = Buffer.from("line1\n\nline3\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[1].lineBytes.length, 0);
    assert.strictEqual(lines[2].lineBytes.toString(), "line3");
  });

  it("handles no trailing newline — final line uses EMPTY_BUF eol", async () => {
    const input = Buffer.from("line1\nline2\nline3");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[1].lineBytes.toString(), "line2");
    assert.strictEqual(lines[2].lineBytes.toString(), "line3");
    assert.strictEqual(lines[2].eolBytes, EMPTY_BUF);
  });

  it("handles totally empty file (no content)", async () => {
    const lines = await collectLines(chunks(Buffer.from("")));
    assert.strictEqual(lines.length, 0);
  });

  it("handles single line with no newline", async () => {
    const lines = await collectLines(chunks(Buffer.from("hello")));
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].lineBytes.toString(), "hello");
    assert.strictEqual(lines[0].eolBytes, EMPTY_BUF);
    assert.strictEqual(lines[0].lineNumber, 1);
  });

  it("handles multiple empty chunks", async () => {
    const lines = await collectLines(chunks(Buffer.from(""), Buffer.from("a\nb\n"), Buffer.from("")));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].lineBytes.toString(), "a");
    assert.strictEqual(lines[1].lineBytes.toString(), "b");
  });
});

// ==============================================================================
// splitChunks — cross-chunk boundary handling
// ==============================================================================
describe("splitChunks — cross-chunk boundaries", () => {
  it("handles LF split across chunks", async () => {
    // "hel" + "lo\nnext\n"
    const lines = await collectLines(chunks(Buffer.from("hel"), Buffer.from("lo\nnext\n")));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].lineBytes.toString(), "hello");
    assert.strictEqual(lines[1].lineBytes.toString(), "next");
  });

  it("handles CRLF split — \\r at end of chunk, \\n at start of next", async () => {
    const lines = await collectLines(chunks(Buffer.from("line1\r"), Buffer.from("\nline2\n")));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[0].eolBytes, CRLF_BUF);
    assert.strictEqual(lines[1].lineBytes.toString(), "line2");
    assert.strictEqual(lines[1].eolBytes, LF_BUF);
  });

  it("handles bare CR at end of chunk — no \\n follows", async () => {
    const lines = await collectLines(chunks(Buffer.from("line1\r"), Buffer.from("line2\n")));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[0].eolBytes, CR_BUF);
    assert.strictEqual(lines[1].lineBytes.toString(), "line2");
    assert.strictEqual(lines[1].eolBytes, LF_BUF);
  });

  it("handles line split across two chunks without line terminator", async () => {
    const lines = await collectLines(chunks(Buffer.from("hel"), Buffer.from("lo")));
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].lineBytes.toString(), "hello");
    assert.strictEqual(lines[0].eolBytes, EMPTY_BUF);
  });

  it("handles CRLF split with content after the \\n", async () => {
    const lines = await collectLines(chunks(Buffer.from("a\r"), Buffer.from("\nb\r\nc\n")));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "a");
    assert.strictEqual(lines[0].eolBytes, CRLF_BUF);
    assert.strictEqual(lines[1].lineBytes.toString(), "b");
    assert.strictEqual(lines[1].eolBytes, CRLF_BUF);
    assert.strictEqual(lines[2].lineBytes.toString(), "c");
    assert.strictEqual(lines[2].eolBytes, LF_BUF);
  });

  it("handles CR at very end of input (no more chunks)", async () => {
    const lines = await collectLines(chunks(Buffer.from("line1\r")));
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[0].eolBytes, CR_BUF);
  });

  it("handles multiple CR endings across chunks", async () => {
    const lines = await collectLines(
      chunks(Buffer.from("a\r"), Buffer.from("b\r"), Buffer.from("c\r")),
    );
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "a");
    assert.strictEqual(lines[0].eolBytes, CR_BUF);
    assert.strictEqual(lines[1].lineBytes.toString(), "b");
    assert.strictEqual(lines[1].eolBytes, CR_BUF);
    assert.strictEqual(lines[2].lineBytes.toString(), "c");
    assert.strictEqual(lines[2].eolBytes, CR_BUF);
  });
});

// ==============================================================================
// splitChunks — binary detection
// ==============================================================================
describe("splitChunks — binary detection", () => {
  it("throws on null bytes when detectBinary=true", async () => {
    const input = Buffer.from("text\nhas\0null\n");
    await assert.rejects(
      () => collectLines(chunks(input), { detectBinary: true }),
      /binary/,
    );
  });

  it("passes through null bytes when detectBinary=false (default)", async () => {
    const input = Buffer.from("has\0null");
    const lines = await collectLines(chunks(input), { detectBinary: false });
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].lineBytes.toString(), "has\0null");
  });

  it("throws on null bytes before any line terminator", async () => {
    const input = Buffer.from("\0data");
    await assert.rejects(
      () => collectLines(chunks(input), { detectBinary: true }),
      /binary/,
    );
  });

  it("throws on null byte in second chunk", async () => {
    const input1 = Buffer.from("line1\n");
    const input2 = Buffer.from("\0line2\n");
    await assert.rejects(
      () => collectLines(chunks(input1, input2), { detectBinary: true }),
      /binary/,
    );
  });

  it("detectBinary=false does not throw on null bytes", async () => {
    const input = Buffer.from("text\nhas\0null\n");
    const lines = await collectLines(chunks(input), { detectBinary: false });
    assert.strictEqual(lines.length, 2);
  });
});

// ==============================================================================
// splitChunks — line number accuracy
// ==============================================================================
describe("splitChunks — line numbers", () => {
  it("increments line numbers sequentially", async () => {
    const input = Buffer.from("a\nb\nc\nd\ne\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 5);
    lines.forEach((l, i) => {
      assert.strictEqual(l.lineNumber, i + 1);
    });
  });

  it("line numbers are correct with CRLF endings", async () => {
    const input = Buffer.from("a\r\nb\r\nc\r\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineNumber, 1);
    assert.strictEqual(lines[1].lineNumber, 2);
    assert.strictEqual(lines[2].lineNumber, 3);
  });

  it("line numbers correct with mixed endings", async () => {
    const input = Buffer.from("a\r\nb\nc\rd\r\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 4);
    assert.strictEqual(lines[0].lineNumber, 1);
    assert.strictEqual(lines[1].lineNumber, 2);
    assert.strictEqual(lines[2].lineNumber, 3);
    assert.strictEqual(lines[3].lineNumber, 4);
  });

  it("line numbers correct with cross-chunk CRLF", async () => {
    const lines = await collectLines(chunks(Buffer.from("a\r"), Buffer.from("\nb\n")));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].lineNumber, 1);
    assert.strictEqual(lines[1].lineNumber, 2);
  });
});

// ==============================================================================
// splitLines — file-based convenience wrapper
// ==============================================================================
describe("splitLines", () => {
  /** @type {string} */
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "line-splitter-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads lines from a file with LF endings", async () => {
    const filePath = join(tmpDir, "lf.txt");
    await writeFile(filePath, "line1\nline2\nline3\n");
    const lines = await collectLinesFrom(splitLines(filePath));
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].lineBytes.toString(), "line1");
    assert.strictEqual(lines[1].lineBytes.toString(), "line2");
    assert.strictEqual(lines[2].lineBytes.toString(), "line3");
    assert.strictEqual(lines[0].lineNumber, 1);
    assert.strictEqual(lines[1].lineNumber, 2);
    assert.strictEqual(lines[2].lineNumber, 3);
  });

  it("reads lines from a file with CRLF endings", async () => {
    const filePath = join(tmpDir, "crlf.txt");
    await writeFile(filePath, "hello\r\nworld\r\n");
    const lines = await collectLinesFrom(splitLines(filePath));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].lineBytes.toString(), "hello");
    assert.strictEqual(lines[1].lineBytes.toString(), "world");
  });

  it("reads lines from a file with no trailing newline", async () => {
    const filePath = join(tmpDir, "notrail.txt");
    await writeFile(filePath, "foo\nbar");
    const lines = await collectLinesFrom(splitLines(filePath));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0].lineBytes.toString(), "foo");
    assert.strictEqual(lines[1].lineBytes.toString(), "bar");
    assert.strictEqual(lines[1].eolBytes, EMPTY_BUF);
  });

  it("throws for binary files when detectBinary=true", async () => {
    const filePath = join(tmpDir, "binary.bin");
    await writeFile(filePath, Buffer.from("text\0bin"));
    await assert.rejects(
      () => collectLinesFrom(splitLines(filePath, { detectBinary: true })),
      /binary/,
    );
  });

  it("detects binary in splitLines with detectBinary=true", async () => {
    const filePath = join(tmpDir, "bin2.bin");
    await writeFile(filePath, Buffer.from("ok\nbad\0stuff\n"));
    await assert.rejects(
      () => collectLinesFrom(splitLines(filePath, { detectBinary: true })),
      /binary/,
    );
  });

  it("reads an empty file — yields no lines", async () => {
    const filePath = join(tmpDir, "empty.txt");
    await writeFile(filePath, "");
    const lines = await collectLinesFrom(splitLines(filePath));
    assert.strictEqual(lines.length, 0);
  });

  it("reads single-line file without newline", async () => {
    const filePath = join(tmpDir, "single.txt");
    await writeFile(filePath, "just one line");
    const lines = await collectLinesFrom(splitLines(filePath));
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].lineBytes.toString(), "just one line");
    assert.strictEqual(lines[0].eolBytes, EMPTY_BUF);
  });

  it("handles file not found", async () => {
    await assert.rejects(
      () => collectLinesFrom(splitLines(join(tmpDir, "nonexistent.txt"))),
      /ENOENT/,
    );
  });
});

// ==============================================================================
// splitChunks — lineBytes content accuracy
// ==============================================================================
describe("splitChunks — content accuracy", () => {
  it("preserves UTF-8 multi-byte sequences", async () => {
    const input = Buffer.from("héllo\nwörld\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines[0].lineBytes.toString(), "héllo");
    assert.strictEqual(lines[1].lineBytes.toString(), "wörld");
  });

  it("preserves trailing whitespace", async () => {
    const input = Buffer.from("  spaced  \n  end  ");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines[0].lineBytes.toString(), "  spaced  ");
    assert.strictEqual(lines[1].lineBytes.toString(), "  end  ");
    assert.strictEqual(lines[1].eolBytes, EMPTY_BUF);
  });

  it("preserves emoji and 4-byte UTF-8", async () => {
    const input = Buffer.from("emoji: 🎉\nnext\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines[0].lineBytes.toString(), "emoji: 🎉");
    assert.strictEqual(lines[1].lineBytes.toString(), "next");
  });

  it("handles only newlines", async () => {
    const input = Buffer.from("\n\n\n");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines.length, 3);
    lines.forEach((l) => assert.strictEqual(l.lineBytes.length, 0));
  });
});

// ==============================================================================
// splitChunks — large input handling
// ==============================================================================
describe("splitChunks — large input", () => {
  it("handles many lines efficiently", async () => {
    // Generate 1000 lines
    const lines = [];
    for (let i = 1; i <= 1000; i++) {
      lines.push(`line ${i}`);
    }
    const input = Buffer.from(lines.join("\n") + "\n");
    const result = await collectLines(chunks(input));
    assert.strictEqual(result.length, 1000);
    assert.strictEqual(result[0].lineBytes.toString(), "line 1");
    assert.strictEqual(result[999].lineBytes.toString(), "line 1000");
  });

  it("handles long lines", async () => {
    const longLine = "x".repeat(100000); // 100KB
    const input = Buffer.from(longLine + "\nend\n");
    const result = await collectLines(chunks(input));
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].lineBytes.length, 100000);
    assert.strictEqual(result[0].lineBytes.toString(), longLine);
    assert.strictEqual(result[1].lineBytes.toString(), "end");
  });
});

// ==============================================================================
// splitChunks — exact byte-level verification
// ==============================================================================
describe("splitChunks — exact byte-level verification", () => {
  it("lineBytes buffers are exact slices, not copies", async () => {
    const input = Buffer.from("hello\nworld\n");
    const lines = await collectLines(chunks(input));
    assert.ok(lines[0].lineBytes.equals(Buffer.from("hello")));
    assert.ok(lines[1].lineBytes.equals(Buffer.from("world")));
  });

  it("eolBytes is the exact correct buffer reference", async () => {
    const input = Buffer.from("a\nb\r\nc\r");
    const lines = await collectLines(chunks(input));
    assert.strictEqual(lines[0].eolBytes, LF_BUF);
    assert.strictEqual(lines[1].eolBytes, CRLF_BUF);
    assert.strictEqual(lines[2].eolBytes, CR_BUF);
  });

  it("does not mutate across iterations (no shared buffer reference)", async () => {
    const input = Buffer.from("a\nb\nc\n");
    const lines = [];
    for await (const line of splitChunks(chunks(input))) {
      // Store a copy
      lines.push({
        lineBytes: Buffer.from(line.lineBytes),
        eolBytes: line.eolBytes,
        lineNumber: line.lineNumber,
      });
    }
    assert.strictEqual(lines[0].lineBytes.toString(), "a");
    assert.strictEqual(lines[1].lineBytes.toString(), "b");
    assert.strictEqual(lines[2].lineBytes.toString(), "c");
  });
});

// ==============================================================================
// splitChunks — error cases
// ==============================================================================
describe("splitChunks — error cases", () => {
  it("forward-throws from a bad async iterable (not a generator issue)", async () => {
    const badIterable = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(new Error("stream error"));
          },
        };
      },
    };
    await assert.rejects(
      () => collectLines(badIterable),
      /stream error/,
    );
  });

  it("binary detection error message mentions null bytes", async () => {
    const input = Buffer.from("\0");
    try {
      for await (const _ of splitChunks(chunks(input), { detectBinary: true })) {
        // Should throw
      }
      assert.fail("Should have thrown");
    } catch (e) {
      assert.ok(e.message.includes("binary"), `Expected "binary" in message, got: ${e.message}`);
      assert.ok(e.message.includes("null"), `Expected "null" in message, got: ${e.message}`);
    }
  });
});
