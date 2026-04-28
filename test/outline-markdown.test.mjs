// ==============================================================================
// Tests for src/read/outline-markdown.js
// ==============================================================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink, mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { extractMarkdownOutline } from "../src/read/outline-markdown.js";

// ==============================================================================
// Test helpers
// ==============================================================================

/**
 * Write a string to a temp file and return the path.
 * @param {string} content
 * @returns {Promise<string>}
 */
async function writeTempFile(content) {
  const dir = join(tmpdir(), "gsd-outline-test-" + Math.random().toString(36).slice(2));
  await mkdir(dir, { recursive: true });
  const fp = join(dir, "test.md");
  await writeFile(fp, content, "utf-8");
  return fp;
}

/**
 * Clean up a temp file.
 * @param {string} fp
 */
async function cleanup(fp) {
  await rm(join(fp, ".."), { recursive: true, force: true });
}

// ==============================================================================
// Tests
// ==============================================================================

describe("extractMarkdownOutline", () => {
  // ── Empty file ──────────────────────────────────────────────────────────────
  it("returns empty array for empty file", async () => {
    const fp = await writeTempFile("");
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.deepStrictEqual(entries, []);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Plain text (no markdown structure) ──────────────────────────────────────
  it("returns empty array for plain text with no markdown structure", async () => {
    const fp = await writeTempFile(
      "This is just a plain text file.\nIt has no headings or anything.\nJust some sentences.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.deepStrictEqual(entries, []);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Headings at multiple levels ─────────────────────────────────────────────
  it("detects headings at multiple levels", async () => {
    const fp = await writeTempFile(
      "# Heading 1\n" +
      "Some content under h1.\n" +
      "## Heading 2\n" +
      "Content under h2.\n" +
      "### Heading 3\n" +
      "Content under h3.\n" +
      "###### Heading 6\n" +
      "Last section.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 4);

      assert.strictEqual(entries[0].type, "h1");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "Heading 1");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 2); // before h2 on line 3

      assert.strictEqual(entries[1].type, "h2");
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].text, "Heading 2");
      assert.strictEqual(entries[1].lineNumber, 3);
      assert.strictEqual(entries[1].endLine, 4);

      assert.strictEqual(entries[2].type, "h3");
      assert.strictEqual(entries[2].depth, 2);
      assert.strictEqual(entries[2].text, "Heading 3");
      assert.strictEqual(entries[2].lineNumber, 5);
      assert.strictEqual(entries[2].endLine, 6);

      // Last heading extends to the last content line (line 8)
      assert.strictEqual(entries[3].type, "h6");
      assert.strictEqual(entries[3].depth, 5);
      assert.strictEqual(entries[3].text, "Heading 6");
      assert.strictEqual(entries[3].lineNumber, 7);
      assert.strictEqual(entries[3].endLine, 8);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Fenced code blocks ──────────────────────────────────────────────────────
  it("detects fenced code blocks with backticks and language", async () => {
    const fp = await writeTempFile(
      "Some text.\n" +
      "```js\n" +
      "const x = 1;\n" +
      "const y = 2;\n" +
      "```\n" +
      "More text.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "fenced_code");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "```js (2 lines)");
      assert.strictEqual(entries[0].lineNumber, 2);
      assert.strictEqual(entries[0].endLine, 5);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects fenced code blocks with tildes", async () => {
    const fp = await writeTempFile(
      "~~~python\n" +
      "def hello():\n" +
      "    pass\n" +
      "~~~\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "fenced_code");
      assert.strictEqual(entries[0].text, "```python (2 lines)");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 4);
    } finally {
      await cleanup(fp);
    }
  });

  it("handles nested backticks inside fenced code", async () => {
    const fp = await writeTempFile(
      "````markdown\n" +
      "```js\n" +
      "code here\n" +
      "```\n" +
      "````\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "fenced_code");
      assert.strictEqual(entries[0].text, "```markdown (3 lines)");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 5);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Tables ──────────────────────────────────────────────────────────────────
  it("detects simple tables", async () => {
    const fp = await writeTempFile(
      "Before.\n" +
      "| Name | Age |\n" +
      "|------|-----|\n" +
      "| Alice | 30 |\n" +
      "| Bob   | 25 |\n" +
      "After.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "table");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "| Name | Age | (2 rows, 2 cols)");
      assert.strictEqual(entries[0].lineNumber, 2);
      assert.strictEqual(entries[0].endLine, 5);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects tables with alignment markers", async () => {
    const fp = await writeTempFile(
      "| Left | Center | Right |\n" +
      "|:-----|:------:|------:|\n" +
      "| A    | B      | C     |\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "table");
      assert.strictEqual(entries[0].text, "| Left | Center | Right | (1 rows, 3 cols)");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 3);
    } finally {
      await cleanup(fp);
    }
  });

  it("does not treat a line with pipe as table if next line is not separator", async () => {
    const fp = await writeTempFile(
      "| Not a table | header\n" +
      "Just some text.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 0);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Blockquotes ─────────────────────────────────────────────────────────────
  it("skips single-line blockquotes (< 3 lines)", async () => {
    const fp = await writeTempFile(
      "> A short note.\n" +
      "Normal text.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 0);
    } finally {
      await cleanup(fp);
    }
  });

  it("skips two-line blockquotes (< 3 lines)", async () => {
    const fp = await writeTempFile(
      "> Line one.\n" +
      "> Line two.\n" +
      "Normal text.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 0);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects multi-line blockquotes (>= 3 lines)", async () => {
    const fp = await writeTempFile(
      "> This is a long\n" +
      "> blockquote spanning\n" +
      "> three or more lines.\n" +
      "Normal text resumes.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "blockquote");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "This is a long (3 lines)");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 3);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Frontmatter ─────────────────────────────────────────────────────────────
  it("detects YAML frontmatter", async () => {
    const fp = await writeTempFile(
      "---\n" +
      "title: Test\n" +
      "author: Me\n" +
      "---\n" +
      "# Real content\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].type, "frontmatter");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "--- (frontmatter, 3 lines)");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 4);
      assert.strictEqual(entries[1].type, "h1");
    } finally {
      await cleanup(fp);
    }
  });

  it("detects frontmatter closed with ...", async () => {
    const fp = await writeTempFile(
      "---\n" +
      "draft: true\n" +
      "...\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "frontmatter");
      assert.strictEqual(entries[0].text, "--- (frontmatter, 2 lines)");
      assert.strictEqual(entries[0].endLine, 3);
    } finally {
      await cleanup(fp);
    }
  });

  it("does not treat ---mid-file as frontmatter", async () => {
    const fp = await writeTempFile(
      "Some text.\n" +
      "---\n" +
      "More text.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 0);
    } finally {
      await cleanup(fp);
    }
  });

  // ── HTML comments ───────────────────────────────────────────────────────────
  it("skips single-line HTML comments", async () => {
    const fp = await writeTempFile(
      "Before.\n" +
      "<!-- short -->\n" +
      "After.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 0);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects multi-line HTML comments (>= 3 lines)", async () => {
    const fp = await writeTempFile(
      "<!--\n" +
      "This is a long comment\n" +
      "spanning multiple lines\n" +
      "-->\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "html_comment");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "<!-- ... --> (4 lines)");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 4);
    } finally {
      await cleanup(fp);
    }
  });

  it("skips two-line HTML comments (< 3 lines)", async () => {
    // 2-line comment: opening + closing must be fewer than 3 lines total
    const fp = await writeTempFile(
      "<!--\n" +
      "just two-->\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 0);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Mixed content ────────────────────────────────────────────────────────────
  it("handles mixed content with all element types", async () => {
    const fp = await writeTempFile(
      "---\n" +
      "title: Mixed\n" +
      "---\n" +
      "# Intro\n" +
      "Some text.\n" +
      "## Details\n" +
      "| Key | Value |\n" +
      "|-----|-------|\n" +
      "| A   | 1     |\n" +
      "| B   | 2     |\n" +
      "```json\n" +
      "{\"key\": \"value\"}\n" +
      "```\n" +
      "> Long\n" +
      "> Blockquote\n" +
      "> Here\n" +
      "> Still going\n" +
      "End.\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      // frontmatter, h1, h2, table, fenced_code, blockquote
      assert.strictEqual(entries.length, 6);
      assert.strictEqual(entries[0].type, "frontmatter");
      assert.strictEqual(entries[1].type, "h1");
      assert.strictEqual(entries[1].text, "Intro");
      assert.strictEqual(entries[2].type, "h2");
      assert.strictEqual(entries[2].text, "Details");
      assert.strictEqual(entries[3].type, "table");
      assert.strictEqual(entries[4].type, "fenced_code");
      assert.strictEqual(entries[5].type, "blockquote");

      // Verify heading range closing
      assert.strictEqual(entries[1].endLine, 5); // h1 ends before h2 on 6
      assert.strictEqual(entries[2].endLine, 10); // h2 ends after table on line 10
    } finally {
      await cleanup(fp);
    }
  });

  // ── Heading range closing ───────────────────────────────────────────────────
  it("closes heading ranges correctly across sections", async () => {
    const fp = await writeTempFile(
      "# A\n" +
      "content a\n" +
      "## B\n" +
      "content b\n" +
      "### C\n" +
      "content c\n" +
      "# D\n" +
      "content d\n"
    );
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 4);

      // h1 "A" ends before h2 "B"
      assert.strictEqual(entries[0].type, "h1");
      assert.strictEqual(entries[0].endLine, 2);

      // h2 "B" ends before h3 "C"
      assert.strictEqual(entries[1].type, "h2");
      assert.strictEqual(entries[1].endLine, 4);

      // h3 "C" ends before h1 "D" (higher-level heading closes lower ones)
      assert.strictEqual(entries[2].type, "h3");
      assert.strictEqual(entries[2].endLine, 6);

      // h1 "D" is last heading — ends at last content line (line 8)
      assert.strictEqual(entries[3].type, "h1");
      assert.strictEqual(entries[3].endLine, 8);
    } finally {
      await cleanup(fp);
    }
  });

  // ── No trailing newline ────────────────────────────────────────────────────
  it("handles file without trailing newline", async () => {
    const fp = await writeTempFile("# No newline at end");
    try {
      const entries = await extractMarkdownOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "h1");
      assert.strictEqual(entries[0].text, "No newline at end");
    } finally {
      await cleanup(fp);
    }
  });
});
