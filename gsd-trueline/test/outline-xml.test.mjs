// ==============================================================================
// Tests for src/read/outline-xml.js
// ==============================================================================
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { extractXmlOutline } from "../src/read/outline-xml.js";

// ==============================================================================
// Test helpers
// ==============================================================================

/**
 * Write a string to a temp file and return the path.
 * @param {string} content
 * @returns {Promise<string>}
 */
async function writeTempFile(content) {
  const dir = join(
    tmpdir(),
    "gsd-xml-test-" + Math.random().toString(36).slice(2),
  );
  await mkdir(dir, { recursive: true });
  const fp = join(dir, "test.xml");
  await writeFile(fp, content, "utf-8");
  return fp;
}

/**
 * Clean up a temp file's parent directory.
 * @param {string} fp
 */
async function cleanup(fp) {
  await rm(join(fp, ".."), { recursive: true, force: true });
}

// ==============================================================================
// Tests
// ==============================================================================

describe("extractXmlOutline", () => {
  // ── Empty file ──────────────────────────────────────────────────────────────
  it("returns empty array for empty file", async () => {
    const fp = await writeTempFile("");
    try {
      const entries = await extractXmlOutline(fp);
      assert.deepStrictEqual(entries, []);
    } finally {
      await cleanup(fp);
    }
  });

  // ── File with only a comment ────────────────────────────────────────────────
  it("returns empty array for file with only comments", async () => {
    const fp = await writeTempFile("<!-- just a comment -->\n");
    try {
      const entries = await extractXmlOutline(fp);
      assert.deepStrictEqual(entries, []);
    } finally {
      await cleanup(fp);
    }
  });

  it("returns empty array for multi-line comment only", async () => {
    const fp = await writeTempFile(
      "<!--\n" + "multi-line\n" + "comment\n" + "-->\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.deepStrictEqual(entries, []);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Simple elements ─────────────────────────────────────────────────────────
  it("detects a single root element", async () => {
    const fp = await writeTempFile("<root></root>\n");
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "<root>");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 1);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects a root element with text content", async () => {
    const fp = await writeTempFile("<root>Hello World</root>\n");
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "<root>");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 1);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects a root element spanning multiple lines", async () => {
    const fp = await writeTempFile("<root>\n<child></child>\n</root>\n");
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      // root spans from line 1 to 3
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "<root>");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 3);
      // child spans from line 2 to 2
      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].text, "<child>");
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 2);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Nested elements with attributes ─────────────────────────────────────────
  it("detects nested elements with attributes", async () => {
    const fp = await writeTempFile(
      "<catalog>\n" +
        '  <book id="1" lang="en">\n' +
        "    <title>Hello</title>\n" +
        "    <author>World</author>\n" +
        "  </book>\n" +
        '  <book id="2" lang="fr">\n' +
        "    <title>Bonjour</title>\n" +
        "    <author>Monde</author>\n" +
        "  </book>\n" +
        "</catalog>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      // catalog (depth 0), book x2 (depth 1), title x2 (depth 2), author x2 (depth 2)
      assert.strictEqual(entries.length, 7);

      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, '<catalog>');
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 10);

      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].text, '<book id="1" lang="en">');
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 5);

      assert.strictEqual(entries[2].type, "element");
      assert.strictEqual(entries[2].depth, 2);
      assert.strictEqual(entries[2].text, "<title>");
      assert.strictEqual(entries[2].lineNumber, 3);
      assert.strictEqual(entries[2].endLine, 3);

      assert.strictEqual(entries[3].type, "element");
      assert.strictEqual(entries[3].depth, 2);
      assert.strictEqual(entries[3].text, "<author>");
      assert.strictEqual(entries[3].lineNumber, 4);
      assert.strictEqual(entries[3].endLine, 4);

      assert.strictEqual(entries[4].type, "element");
      assert.strictEqual(entries[4].depth, 1);
      assert.strictEqual(entries[4].text, '<book id="2" lang="fr">');
      assert.strictEqual(entries[4].lineNumber, 6);
      assert.strictEqual(entries[4].endLine, 9);

      assert.strictEqual(entries[5].type, "element");
      assert.strictEqual(entries[5].depth, 2);
      assert.strictEqual(entries[5].text, "<title>");
      assert.strictEqual(entries[5].lineNumber, 7);
      assert.strictEqual(entries[5].endLine, 7);

      assert.strictEqual(entries[6].type, "element");
      assert.strictEqual(entries[6].depth, 2);
      assert.strictEqual(entries[6].text, "<author>");
      assert.strictEqual(entries[6].lineNumber, 8);
      assert.strictEqual(entries[6].endLine, 8);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects elements with namespaced tags", async () => {
    const fp = await writeTempFile(
      "<ns:root xmlns:ns=\"http://example.com\">\n" +
      "  <ns:child></ns:child>\n" +
      "</ns:root>\n"
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 3);
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 2);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Self-closing elements ───────────────────────────────────────────────────
  it("detects self-closing elements", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <br/>\n" +
        '  <img src="foo.png"/>\n' +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 3);

      // root
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "<root>");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 4);

      // br (self-closing, single-line)
      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].text, "<br />");
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 2);

      // img (self-closing, single-line)
      assert.strictEqual(entries[2].type, "element");
      assert.strictEqual(entries[2].depth, 1);
      assert.strictEqual(entries[2].text, '<img src="foo.png" />');
      assert.strictEqual(entries[2].lineNumber, 3);
      assert.strictEqual(entries[2].endLine, 3);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects self-closing elements with space before />", async () => {
    const fp = await writeTempFile('<empty />\n');
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].text, "<empty />");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 1);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Processing instructions ─────────────────────────────────────────────────
  it("detects top-level processing instructions", async () => {
    const fp = await writeTempFile(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        "<root>\n" +
        "  <child></child>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      // PI + root + child = 3 entries
      assert.strictEqual(entries.length, 3);

      // PI at top-level (depth 0)
      assert.strictEqual(entries[0].type, "processing_instruction");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(
        entries[0].text,
        '<?xml version="1.0" encoding="UTF-8"?>',
      );
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 1);

      // root element
      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].depth, 0);
      assert.strictEqual(entries[1].text, "<root>");
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 4);
    } finally {
      await cleanup(fp);
    }
  });

  it("ignores processing instructions inside elements", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <?somepi content?>\n" +
        "  <child></child>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      // Only root and child — PI inside root should be ignored (depth > 0)
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].depth, 1);
    } finally {
      await cleanup(fp);
    }
  });

  it("detects multi-line processing instructions", async () => {
    const fp = await writeTempFile(
      "<?xml\n" +
        'version="1.0"\n' +
        'encoding="UTF-8"?>\n' +
        "<root></root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].type, "processing_instruction");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 3);
      assert.strictEqual(entries[0].text.startsWith("<?xml"), true);
      assert.strictEqual(entries[0].text.endsWith("?>"), true);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Comments ────────────────────────────────────────────────────────────────
  it("skips comments between elements", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <!-- a comment -->\n" +
        "  <child></child>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[1].depth, 1);
    } finally {
      await cleanup(fp);
    }
  });

  it("skips multi-line comments", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <!--\n" +
        "    long\n" +
        "    comment\n" +
        "  -->\n" +
        "  <child></child>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[1].depth, 1);
    } finally {
      await cleanup(fp);
    }
  });

  // ── CDATA sections ─────────────────────────────────────────────────────────
  it("skips CDATA sections", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <![CDATA[some <encoded> content]]>\n" +
        "  <child></child>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[1].depth, 1);
    } finally {
      await cleanup(fp);
    }
  });

  it("skips multi-line CDATA sections", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <![CDATA[\n" +
        "    line1\n" +
        "    line2\n" +
        "  ]]>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].text, "<root>");
    } finally {
      await cleanup(fp);
    }
  });

  // ── DOCTYPE declaration ────────────────────────────────────────────────────
  it("skips DOCTYPE declaration", async () => {
    const fp = await writeTempFile(
      '<!DOCTYPE html>\n' +
        "<html></html>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].text, "<html>");
      assert.strictEqual(entries[0].depth, 0);
    } finally {
      await cleanup(fp);
    }
  });

  it("skips DOCTYPE with internal subset", async () => {
    const fp = await writeTempFile(
      "<!DOCTYPE foo [\n" +
        "  <!ELEMENT foo (#PCDATA)>\n" +
        "]>\n" +
        "<foo></foo>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].text, "<foo>");
    } finally {
      await cleanup(fp);
    }
  });

  it("skips DOCTYPE with system/public identifiers", async () => {
    const fp = await writeTempFile(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n' +
        "<html></html>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].text, "<html>");
    } finally {
      await cleanup(fp);
    }
  });

  // ── Multi-line attribute values ─────────────────────────────────────────────
  it("handles attributes spanning multiple lines", async () => {
    const fp = await writeTempFile(
      '<root\n' +
        '  attr1="value1"\n' +
        '  attr2="value2">\n' +
        "  <child></child>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);

      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 5);
      // Text should contain the collapsed attributes
      assert.ok(entries[0].text.includes('attr1='));
      assert.ok(entries[0].text.includes('attr2='));

      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].lineNumber, 4);
      assert.strictEqual(entries[1].endLine, 4);
    } finally {
      await cleanup(fp);
    }
  });

  it("handles close tags spanning multiple lines", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <child></child\n" +
        "  >\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 4);
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 3);
    } finally {
      await cleanup(fp);
    }
  });

  it("handles attributes with > inside quoted values", async () => {
    const fp = await writeTempFile(
      '<root><child attr="a > b" /></root>\n',
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].text, "<root>");
      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].text, '<child attr="a > b" />');
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].lineNumber, 1);
      assert.strictEqual(entries[1].endLine, 1);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Mismatched close tags ─────────────────────────────────────────────────
  it("tolerates mismatched close tags", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <child></wrong>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      // root and child should both be present
      assert.strictEqual(entries.length, 2);
      // root: still has its child unclosed, so child stays on stack
      // Actually the close tag `</wrong>` doesn't match `child`, so `child` stays
      // on the stack and shows up at EOF.
      // `</wrong>` doesn't match `root` either (different name), so ignored.
      // At EOF: `child` and `root` are unclosed and closed by finalization.
      assert.strictEqual(entries[0].type, "element");
      assert.strictEqual(entries[0].text, "<root>");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 3); // closed at EOF
      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].text, "<child>");
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 3); // closed at EOF
    } finally {
      await cleanup(fp);
    }
  });

  it("tolerates mismatched close tag that partially matches stack", async () => {
    const fp = await writeTempFile(
      "<a>\n" +
        "  <b>\n" +
        "    <c></b>\n" +
        "  </a>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      // `</b>` closes `b`, leaving `c` unclosed on stack (inside `a`)
      // At EOF: `c` and `a` are closed by finalization
      assert.strictEqual(entries.length, 3);
      assert.strictEqual(entries[0].text, "<a>");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 4);
      assert.strictEqual(entries[1].text, "<b>");
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 3);
      assert.strictEqual(entries[2].text, "<c>");
      assert.strictEqual(entries[2].lineNumber, 3);
      assert.strictEqual(entries[2].endLine, 4);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Unclosed elements at EOF ───────────────────────────────────────────────
  it("closes unclosed elements at EOF", async () => {
    const fp = await writeTempFile("<root>\n  <child>\n  </child>\n");
    // No newline at end, and </child> is on line 3 but no </root>
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].text, "<root>");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 3); // closed at EOF
      assert.strictEqual(entries[1].text, "<child>");
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 3);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Multiple constructs on a single line ──────────────────────────────────
  it("handles multiple elements on a single line", async () => {
    const fp = await writeTempFile(
      "<root><child><grandchild/></child></root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 3);
      assert.strictEqual(entries[0].text, "<root>");
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 1);
      assert.strictEqual(entries[1].text, "<child>");
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].lineNumber, 1);
      assert.strictEqual(entries[1].endLine, 1);
      assert.strictEqual(entries[2].text, "<grandchild />");
      assert.strictEqual(entries[2].depth, 2);
      assert.strictEqual(entries[2].lineNumber, 1);
      assert.strictEqual(entries[2].endLine, 1);
    } finally {
      await cleanup(fp);
    }
  });

  it("handles multiple constructs on a single line with mixed types", async () => {
    const fp = await writeTempFile(
      "<?proc?><root><!--comment--><child/><![CDATA[data]]></root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 3);
      assert.strictEqual(entries[0].type, "processing_instruction");
      assert.strictEqual(entries[1].text, "<root>");
      assert.strictEqual(entries[1].depth, 0);
      assert.strictEqual(entries[2].text, "<child />");
      assert.strictEqual(entries[2].depth, 1);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Edge: file with no elements ───────────────────────────────────────────
  it("returns empty array for file with no elements", async () => {
    const fp = await writeTempFile("Just text, no XML.\n");
    try {
      const entries = await extractXmlOutline(fp);
      assert.deepStrictEqual(entries, []);
    } finally {
      await cleanup(fp);
    }
  });

  it("returns empty array for file with only whitespace", async () => {
    const fp = await writeTempFile("  \n  \n  \n");
    try {
      const entries = await extractXmlOutline(fp);
      assert.deepStrictEqual(entries, []);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Edge: very deep nesting ───────────────────────────────────────────────
  it("handles deep nesting", async () => {
    const fp = await writeTempFile(
      "<a>\n" +
        "<b>\n" +
        "<c>\n" +
        "<d></d>\n" +
        "</c>\n" +
        "</b>\n" +
        "</a>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 4);
      assert.strictEqual(entries[0].text, "<a>");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[0].lineNumber, 1);
      assert.strictEqual(entries[0].endLine, 7);
      assert.strictEqual(entries[1].text, "<b>");
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 6);
      assert.strictEqual(entries[2].text, "<c>");
      assert.strictEqual(entries[2].depth, 2);
      assert.strictEqual(entries[2].lineNumber, 3);
      assert.strictEqual(entries[2].endLine, 5);
      assert.strictEqual(entries[3].text, "<d>");
      assert.strictEqual(entries[3].depth, 3);
      assert.strictEqual(entries[3].lineNumber, 4);
      assert.strictEqual(entries[3].endLine, 4);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Edge: XML declaration with attributes on same line ────────────────────
  it("handles XML declaration with multiple attributes on same line", async () => {
    const fp = await writeTempFile(
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
        "<document></document>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].type, "processing_instruction");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[1].type, "element");
      assert.strictEqual(entries[1].depth, 0);
      assert.strictEqual(entries[1].text, "<document>");
    } finally {
      await cleanup(fp);
    }
  });

  // ── Edge: Only a DOCTYPE with no root element ────────────────────────────
  it("handles DOCTYPE with no root element", async () => {
    const fp = await writeTempFile("<!DOCTYPE foo>\n");
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 0);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Edge: Only processing instructions ───────────────────────────────────
  it("handles file with only processing instructions", async () => {
    const fp = await writeTempFile('<?xml version="1.0"?>\n');
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, "processing_instruction");
    } finally {
      await cleanup(fp);
    }
  });

  // ── Edge: Tag with single-quoted attributes ──────────────────────────────
  it("handles single-quoted attribute values", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <child id='v1' name='test'></child>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[1].depth, 1);
      assert.ok(entries[1].text.includes("id="));
    } finally {
      await cleanup(fp);
    }
  });

  // ── Edge: HTML-style self-closing tags (no space before /) ───────────
  it("handles self-closing tags without space before />", async () => {
    const fp = await writeTempFile(
      "<root>\n" +
        "  <br/>\n" +
        "  <hr/>\n" +
        "</root>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 3);
      assert.strictEqual(entries[1].text, "<br />");
      assert.strictEqual(entries[2].text, "<hr />");
    } finally {
      await cleanup(fp);
    }
  });

  // ── Edge: With text content and empty elements ─────────────────────────
  it("handles elements with text content and empty elements", async () => {
    const fp = await writeTempFile(
      "<paragraph>\n" +
        "  This text has <emphasis>bold</emphasis> and <void/>.\n" +
        "</paragraph>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 3);
      assert.strictEqual(entries[0].text, "<paragraph>");
      assert.strictEqual(entries[0].depth, 0);
      assert.strictEqual(entries[1].text, "<emphasis>");
      assert.strictEqual(entries[1].depth, 1);
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 2);
      assert.strictEqual(entries[2].text, "<void />");
      assert.strictEqual(entries[2].depth, 1);
      assert.strictEqual(entries[2].lineNumber, 2);
      assert.strictEqual(entries[2].endLine, 2);
    } finally {
      await cleanup(fp);
    }
  });

  // ── Real-world XML: RSS feed ────────────────────────────────────────────
  it("handles a real-world XML structure (RSS)", async () => {
    const fp = await writeTempFile(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<rss version="2.0">\n' +
        "  <channel>\n" +
        "    <title>My Feed</title>\n" +
        "    <link>http://example.com</link>\n" +
        "    <item>\n" +
        "      <title>Post 1</title>\n" +
        "      <description>Desc 1</description>\n" +
        "    </item>\n" +
        "    <item>\n" +
        "      <title>Post 2</title>\n" +
        "      <description>Desc 2</description>\n" +
        "    </item>\n" +
        "  </channel>\n" +
        "</rss>\n",
    );
    try {
      const entries = await extractXmlOutline(fp);
      assert.strictEqual(entries.length, 11); // PI + 10 elements
      assert.strictEqual(entries[0].type, "processing_instruction");
      assert.strictEqual(entries[1].text, '<rss version="2.0">');
      assert.strictEqual(entries[1].depth, 0);
      assert.strictEqual(entries[1].lineNumber, 2);
      assert.strictEqual(entries[1].endLine, 15);
      assert.strictEqual(entries[2].text, "<channel>");
      assert.strictEqual(entries[2].depth, 1);
      assert.strictEqual(entries[2].lineNumber, 3);
      assert.strictEqual(entries[2].endLine, 14);
      // Verify item boundaries
      assert.strictEqual(entries[5].text, "<item>");
      assert.strictEqual(entries[5].depth, 2);
      assert.strictEqual(entries[5].lineNumber, 6);
      assert.strictEqual(entries[5].endLine, 9);
      assert.strictEqual(entries[8].text, "<item>");
      assert.strictEqual(entries[8].depth, 2);
      assert.strictEqual(entries[8].lineNumber, 10);
      assert.strictEqual(entries[8].endLine, 13);
    } finally {
      await cleanup(fp);
    }
  });
});
