// ==============================================================================
// Streaming markdown outline state machine
//
// Streams a file via splitLines — never loads the full file into memory.
// Produces an array of OutlineEntry objects representing the document's
// structural outline: headings, fenced code blocks, tables, blockquotes,
// frontmatter, and HTML comments.
// ==============================================================================

import { splitLines } from "./line-splitter.js";

// ==============================================================================
// State machine constants
// ==============================================================================

const State = Object.freeze({
  NORMAL: "NORMAL",
  IN_FRONTMATTER: "IN_FRONTMATTER",
  IN_FENCE: "IN_FENCE",
  IN_TABLE: "IN_TABLE",
  IN_HTML_COMMENT: "IN_HTML_COMMENT",
  IN_BLOCKQUOTE: "IN_BLOCKQUOTE",
});

// ==============================================================================
// Regex patterns
// ==============================================================================

/** Heading: up to 3 leading spaces, # marks, then mandatory space. */
const HEADING_RE = /^ {0,3}(#{1,6})\s+/;

/** Fenced code: 3+ backticks or tildes, optional language tag. */
const FENCE_BACK_RE = /^ {0,3}(`{3,})\s*(.*)$/;
const FENCE_TILD_RE = /^ {0,3}(~{3,})\s*(.*)$/;

/** Table separator row: |---|---| pattern with optional alignment markers. */
const TABLE_SEP_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;

/** HTML comment boundaries. */
const HTML_COMMENT_RE = /^\s*<!--/;
const HTML_COMMENT_END_RE = /-->/;

/** Blockquote: optional leading spaces, >, optional space. */
const BLOCKQUOTE_RE = /^ {0,3}> ?/;

/** Frontmatter boundaries. */
const FRONTMATTER_END_RE = /^---\s*$/;
const FRONTMATTER_DOTS_RE = /^\.\.\.\s*$/;

// ==============================================================================
// Helpers
// ==============================================================================

/**
 * Count the number of columns in a table row by counting pipe characters.
 * @param {string} row
 * @returns {number}
 */
function countCols(row) {
  let n = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "|") n++;
  }
  return n > 0 ? n - 1 : 0;
}

/**
 * Check if a type string represents a markdown heading (h1-h6).
 * @param {string} type
 * @returns {boolean}
 */
function isHeading(type) {
  return type.length === 2 && type[0] === "h" && type[1] >= "1" && type[1] <= "6";
}

// ==============================================================================
// OutlineEntry
// ==============================================================================

/**
 * @typedef {Object} OutlineEntry
 * @property {string} type - Entry type: 'h1'..'h6', 'fenced_code', 'table', 'blockquote', 'frontmatter', 'html_comment'
 * @property {number} depth - Heading level minus 1 (0 for non-heading entries)
 * @property {string} text - Display text for the entry
 * @property {number} lineNumber - Start line number (1-based)
 * @property {number} endLine - End line number (inclusive)
 */

// ==============================================================================
// Main export
// ==============================================================================

/**
 * Stream a markdown file and extract its structural outline.
 *
 * Returns an array of OutlineEntry objects, one per structural element found.
 * Plain text between structural elements is not included.
 *
 * @param {string} filePath - Path to the markdown file.
 * @returns {Promise<OutlineEntry[]>}
 */
export async function extractMarkdownOutline(filePath) {
  /** @type {OutlineEntry[]} */
  const entries = [];

  let mode = State.NORMAL;
  let prevHeading = null;

  // Table lookahead: when a line contains `|` we buffer it and peek at the
  // next line to determine whether it's a table header or just a line with a pipe.
  let lookaheadLine = null;
  let lookaheadNum = null;

  // Fence tracking
  let fenceChar = "";
  let fenceCount = 0;
  let fenceLang = "";
  let fenceLineCount = 0;
  let fenceStartLine = 0;

  // Table tracking
  let tableHeader = "";
  let tableRowCount = 0;
  let tableColCount = 0;
  let tableStartLine = 0;
  let tablePastSep = false;

  // Blockquote tracking
  let bqLines = [];
  let bqStartLine = 0;

  // HTML comment tracking
  let comLines = [];
  let comStartLine = 0;

  // Frontmatter tracking
  let fmLineCount = 0;
  let fmStartLine = 0;

  /** Track last content line for closing heading ranges at EOF. */
  let lastContentLine = 0;

  /**
   * Close the previous heading's range when a new heading is found.
   * @param {number} lineNumber
   */
  function closePrevHeading(lineNumber) {
    if (prevHeading) {
      prevHeading.endLine = lineNumber - 1;
      prevHeading = null;
    }
  }

  /**
   * Push an entry and set it as the previous heading if it's a heading type.
   * @param {string} type
   * @param {number} depth
   * @param {string} text
   * @param {number} lineNumber
   * @param {number} endLine
   */
  function pushEntry(type, depth, text, lineNumber, endLine) {
    const entry = { type, depth, text, lineNumber, endLine };
    entries.push(entry);
    if (isHeading(type)) prevHeading = entry;
  }

  /**
   * Finalize: close any open state at EOF.
   */
  function finalizeOpenEntries() {
    if (prevHeading) {
      prevHeading.endLine = lastContentLine;
      prevHeading = null;
    }

    if (mode === State.IN_FENCE) {
      pushEntry("fenced_code", 0, `${"`".repeat(3)}${fenceLang} (${fenceLineCount} lines)`, fenceStartLine, fenceStartLine + fenceLineCount);
      mode = State.NORMAL;
    }

    if (mode === State.IN_TABLE && tablePastSep) {
      pushEntry("table", 0, `${tableHeader} (${tableRowCount} rows, ${tableColCount} cols)`, tableStartLine, tableStartLine + tableRowCount + 1);
      mode = State.NORMAL;
    }

    if (mode === State.IN_BLOCKQUOTE && bqLines.length >= 3) {
      const first = bqLines[0].substring(0, 40).trim();
      pushEntry("blockquote", 0, `${first} (${bqLines.length} lines)`, bqStartLine, bqStartLine + bqLines.length - 1);
      mode = State.NORMAL;
    }

    if (mode === State.IN_HTML_COMMENT && comLines.length >= 3) {
      pushEntry("html_comment", 0, `<!-- ... --> (${comLines.length} lines)`, comStartLine, comStartLine + comLines.length - 1);
      mode = State.NORMAL;
    }

    if (mode === State.IN_FRONTMATTER) {
      pushEntry("frontmatter", 0, `--- (frontmatter, ${fmLineCount} lines)`, fmStartLine, fmStartLine + fmLineCount - 1);
      mode = State.NORMAL;
    }
  }

  // Use manual async iteration so we can peek ahead for table detection.
  const iterator = splitLines(filePath)[Symbol.asyncIterator]();
  let { value, done } = await iterator.next();

  while (!done) {
    const line = value.lineBytes.toString("utf-8");
    const ln = value.lineNumber;
    lastContentLine = ln;

    // ── Handle lookahead buffer from a previous NORMAL-mode `|` line ──────────
    if (lookaheadLine !== null) {
      // Current line is the candidate's successor — check if it's a table separator.
      if (TABLE_SEP_RE.test(line)) {
        // It IS a table — enter IN_TABLE. The lookahead line is the header, current
        // line is the separator. Advance to the first data row.
        mode = State.IN_TABLE;
        tableHeader = lookaheadLine.trim();
        tableRowCount = 0;
        tableColCount = countCols(lookaheadLine);
        tableStartLine = lookaheadNum;
        tablePastSep = false;
        lookaheadLine = null;
        lookaheadNum = null;
        ({ value, done } = await iterator.next());
        continue;
      }

      // Not a table — the lookahead line was just a normal line with `|`.
      lookaheadLine = null;
      lookaheadNum = null;
    }

    // ── State machine dispatch ─────────────────────────────────────────────────
    switch (mode) {
      // ========================================================================
      // NORMAL — scan for any structural element
      // ========================================================================
      case State.NORMAL: {
        // 1. Frontmatter on line 1
        if (ln === 1 && FRONTMATTER_END_RE.test(line)) {
          mode = State.IN_FRONTMATTER;
          fmStartLine = 1;
          fmLineCount = 1;
          break;
        }

        // 2. Heading (h1-h6)
        const hm = line.match(HEADING_RE);
        if (hm) {
          closePrevHeading(ln);
          const level = hm[1].length;
          const text = line.slice(hm[0].length).trim();
          pushEntry(`h${level}`, level - 1, text, ln, ln);
          break;
        }

        // 3. Fenced code block opening
        const fb = line.match(FENCE_BACK_RE) || line.match(FENCE_TILD_RE);
        if (fb) {
          mode = State.IN_FENCE;
          fenceChar = fb[1][0];
          fenceCount = fb[1].length;
          fenceLang = fb[2].trim();
          fenceLineCount = 0;
          fenceStartLine = ln;
          break;
        }

        // 4. HTML comment start
        if (HTML_COMMENT_RE.test(line)) {
          if (HTML_COMMENT_END_RE.test(line)) {
            // Single-line comment: <!-- ... -->, skip entirely.
            break;
          }
          mode = State.IN_HTML_COMMENT;
          comLines = [line];
          comStartLine = ln;
          break;
        }

        // 5. Blockquote start
        if (BLOCKQUOTE_RE.test(line)) {
          mode = State.IN_BLOCKQUOTE;
          bqLines = [line.replace(BLOCKQUOTE_RE, "").trimEnd()];
          bqStartLine = ln;
          break;
        }

        // 6. Table lookahead — buffer the line and check the next line.
        if (line.includes("|")) {
          const peek = await iterator.next();
          if (peek.done) break; // lone `|` line at EOF, skip

          const peekLine = peek.value.lineBytes.toString("utf-8");
          if (TABLE_SEP_RE.test(peekLine)) {
            // Confirmed table: header = current line, separator = peek line.
            mode = State.IN_TABLE;
            tableHeader = line.trim();
            tableRowCount = 0;
            tableColCount = countCols(line);
            tableStartLine = ln;
            tablePastSep = false;
            // Advance to first data row.
            ({ value, done } = await iterator.next());
          } else {
            // Not a table — treat peek as the value to continue with.
            // Store the buffer so we can skip structural checks on the current
            // `|`-containing line (handled at the top of the loop).
            lookaheadLine = line;
            lookaheadNum = ln;
            value = peek.value;
            done = peek.done;
          }
          continue; // skip the default iterator advance
        }

        // 7. Plain text — no structural element, skip.
        break;
      }

      // ========================================================================
      // IN_FENCE — track lines until a matching closing fence.
      // ========================================================================
      case State.IN_FENCE: {
        const trimmed = line.trimStart();
        const closer =
          trimmed.startsWith(fenceChar.repeat(fenceCount)) &&
          trimmed.slice(fenceCount).trim() === "";

        if (closer) {
          mode = State.NORMAL;
          closePrevHeading(ln);
          pushEntry("fenced_code", 0, `${"`".repeat(3)}${fenceLang} (${fenceLineCount} lines)`, fenceStartLine, ln);
        } else {
          fenceLineCount++;
        }
        break;
      }

      // ========================================================================
      // IN_TABLE — count rows until a non-table line.
      // ========================================================================
      case State.IN_TABLE: {
        if (line.includes("|")) {
          if (!tablePastSep) {
            tablePastSep = true; // first row after the separator
          }
          tableRowCount++;
        } else {
          mode = State.NORMAL;
          closePrevHeading(ln);
          pushEntry("table", 0, `${tableHeader} (${tableRowCount} rows, ${tableColCount} cols)`, tableStartLine, ln - 1);
          continue; // re-process this line in NORMAL mode
        }
        break;
      }

      // ========================================================================
      // IN_BLOCKQUOTE — collect lines until a non-quote line.
      // ========================================================================
      case State.IN_BLOCKQUOTE: {
        const bqm = line.match(BLOCKQUOTE_RE);
        if (bqm) {
          bqLines.push(line.replace(BLOCKQUOTE_RE, "").trimEnd());
        } else {
          mode = State.NORMAL;
          if (bqLines.length >= 3) {
            closePrevHeading(ln);
            const first = bqLines[0].substring(0, 40).trim();
            pushEntry("blockquote", 0, `${first} (${bqLines.length} lines)`, bqStartLine, ln - 1);
          }
          continue; // re-process this line in NORMAL mode
        }
        break;
      }

      // ========================================================================
      // IN_HTML_COMMENT — collect lines until the closing -->.
      // ========================================================================
      case State.IN_HTML_COMMENT: {
        if (HTML_COMMENT_END_RE.test(line)) {
          mode = State.NORMAL;
          comLines.push(line);
          if (comLines.length >= 3) {
            closePrevHeading(ln);
            pushEntry("html_comment", 0, `<!-- ... --> (${comLines.length} lines)`, comStartLine, ln);
          }
        } else {
          comLines.push(line);
        }
        break;
      }

      // ========================================================================
      // IN_FRONTMATTER — collect lines until closing --- or ...
      // ========================================================================
      case State.IN_FRONTMATTER: {
        if (FRONTMATTER_END_RE.test(line) || FRONTMATTER_DOTS_RE.test(line)) {
          mode = State.NORMAL;
          closePrevHeading(ln);
          pushEntry("frontmatter", 0, `--- (frontmatter, ${fmLineCount} lines)`, fmStartLine, ln);
        } else {
          fmLineCount++;
        }
        break;
      }

      default:
        break;
    }

    if (done) break;
    ({ value, done } = await iterator.next());
  }

  // Handle EOF — close any remaining open entries.
  finalizeOpenEntries();

  return entries;
}
