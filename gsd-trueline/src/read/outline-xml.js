// ==============================================================================
// Streaming XML outline SAX state machine
//
// Streams a file via splitLines — never loads the full file into memory.
// Uses a 6-state SAX machine (Text, TagOpen, Comment, CData, PI, DocType)
// to produce structural outline entries for XML files.
//
// Ported from trueline-mcp's src/outline/xml.ts to plain ESM JavaScript.
// ==============================================================================

import { splitLines } from "./line-splitter.js";

// ==============================================================================
// State machine constants
// ==============================================================================

const State = Object.freeze({
  TEXT: "TEXT",
  TAG_OPEN: "TAG_OPEN",
  COMMENT: "COMMENT",
  CDATA: "CDATA",
  PI: "PI",
  DOCTYPE: "DOCTYPE",
});

// ==============================================================================
// XmlOutlineEntry (JSDoc)
// ==============================================================================

/**
 * @typedef {Object} XmlOutlineEntry
 * @property {string} type - Entry type: 'element' | 'processing_instruction'
 * @property {number} depth - Nesting depth (0 for root-level elements and top-level PIs)
 * @property {string} text - Display text (formatted tag or PI, truncated to 200 chars)
 * @property {number} lineNumber - Start line number (1-based)
 * @property {number} endLine - End line number (inclusive)
 */

// ==============================================================================
// Helpers
// ==============================================================================

/**
 * Find the closing `>` of an XML tag, accounting for single and double quoted
 * attribute values. Returns -1 if not found in the given string.
 *
 * @param {string} str - String to search.
 * @param {number} start - Index to start searching from.
 * @returns {number} Index of `>` or -1.
 */
function findTagEnd(str, start) {
  let inSQ = false;
  let inDQ = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"' && !inSQ) inDQ = !inDQ;
    else if (ch === "'" && !inDQ) inSQ = !inSQ;
    else if (ch === ">" && !inSQ && !inDQ) return i;
  }
  return -1;
}

/**
 * Extract the tag name from tag content (between `<` and `>`).
 * Handles open tags, close tags (prefixed with `/`), and self-closing.
 *
 * @param {string} content - Tag content without angle brackets.
 * @returns {string}
 */
function extractTagName(content) {
  const s = content.trimStart();
  const start = s.startsWith("/") ? s.slice(1).trimStart() : s;
  const m = start.match(/^[^\s>/]+/);
  return m ? m[0] : "unknown";
}

/**
 * Check if tag content represents a self-closing tag (ends with `/`).
 *
 * @param {string} content - Tag content without angle brackets.
 * @returns {boolean}
 */
function isSelfClosing(content) {
  return content.trimEnd().endsWith("/");
}

/**
 * Format a tag signature, truncated to 200 characters.
 *
 * @param {string} tagName - The tag name.
 * @param {string} content - Full tag content between `<` and `>`.
 * @param {boolean} selfClosing - Whether the tag is self-closing.
 * @returns {string}
 */
function formatTag(tagName, content, selfClosing) {
  if (selfClosing) {
    // Strip trailing / from content and format as <name attrs />
    const base = content.trimEnd().replace(/\/\s*$/, "").trimEnd();
    let result = `<${base} />`;
    if (result.length > 200) result = result.slice(0, 200) + "…";
    return result;
  }
  let result = `<${content.trim()}>`;
  if (result.length > 200) {
    result = result.slice(0, 200) + "…";
  }
  return result;
}

/**
 * Format a processing instruction signature, truncated to 200 characters.
 *
 * @param {string} content - Content between `<?` and `?>`.
 * @returns {string}
 */
function formatPI(content) {
  let result = `<?${content.trim()}?>`;
  if (result.length > 200) {
    result = result.slice(0, 200) + "…";
  }
  return result;
}

// ==============================================================================
// Main export
// ==============================================================================

/**
 * Stream an XML file and extract its structural outline.
 *
 * Uses a 6-state SAX state machine: Text → TagOpen → Comment → CData → PI → DocType.
 * Returns an array of XmlOutlineEntry objects:
 * - `element` entries for each non-self-closing element, with range covering
 *   from opening tag to matching closing tag (or EOF for unclosed elements).
 * - `processing_instruction` entries for top-level (depth 0) PIs only.
 * - Self-closing tags emit an element entry on a single line.
 * - Comments, CDATA sections, and DOCTYPE declarations are skipped.
 *
 * @param {string} filePath - Path to the XML file.
 * @returns {Promise<XmlOutlineEntry[]>}
 */
export async function extractXmlOutline(filePath) {
  /** @type {XmlOutlineEntry[]} */
  const entries = [];

  /** @type {{ tagName: string, depth: number, startLine: number, text: string }[]} */
  const elementStack = [];

  let state = State.TEXT;

  // Multi-line construct accumulators
  let accum = "";
  let accumStart = 1;

  // Line buffer for re-processing remainder of a line after a multi-line
  // construct closes mid-line.
  let savedLine = null;
  let savedLineno = 0;

  const iter = splitLines(filePath)[Symbol.asyncIterator]();
  let { value, done } = await iter.next();
  let totalLines = 0;

  while (true) {
    // ── Resolve current line ─────────────────────────────────────────────
    /** @type {string} */
    let line;
    /** @type {number} */
    let ln;

    if (savedLine !== null) {
      line = savedLine;
      ln = savedLineno;
      savedLine = null;
      savedLineno = 0;
    } else if (done) {
      break;
    } else {
      line = value.lineBytes.toString("utf-8");
      ln = value.lineNumber;
      totalLines = ln;
      ({ value, done } = await iter.next());
    }

    // ======================================================================
    // TEXT state — scan for `<` to detect any XML construct
    // ======================================================================
    if (state === State.TEXT) {
      let i = 0;

      while (i < line.length) {
        const lt = line.indexOf("<", i);
        if (lt === -1) break;

        const after = line[lt + 1];

        // ── 1. Close tag: </name> ────────────────────────────────────────
        if (after === "/") {
          const gt = findTagEnd(line, lt + 2);
          if (gt !== -1) {
            const tagName = extractTagName(line.slice(lt + 2, gt));
            // Pop matching element from the stack (tolerate mismatches)
            for (let si = elementStack.length - 1; si >= 0; si--) {
              if (elementStack[si].tagName === tagName) {
                const elem = elementStack.splice(si, 1)[0];
                entries.push({
                  type: "element",
                  depth: elem.depth,
                  text: elem.text,
                  lineNumber: elem.startLine,
                  endLine: ln,
                });
                break;
              }
            }
            i = gt + 1;
            continue;
          }
          // Close tag spans multiple lines
          accum = "/" + line.slice(lt + 2); // preserve / prefix for TAG_OPEN
          accumStart = ln;
          state = State.TAG_OPEN;
          break;
        }

        // ── 2. Processing instruction: <?...?> ───────────────────────────
        if (after === "?") {
          const piEnd = line.indexOf("?>", lt + 2);
          if (piEnd !== -1) {
            // Top-level (depth 0) PIs only
            if (elementStack.length === 0) {
              entries.push({
                type: "processing_instruction",
                depth: 0,
                text: formatPI(line.slice(lt + 2, piEnd)),
                lineNumber: ln,
                endLine: ln,
              });
            }
            i = piEnd + 2;
            continue;
          }
          // Multi-line PI
          accum = line.slice(lt + 2);
          accumStart = ln;
          state = State.PI;
          break;
        }

        // ── 3. Comment: <!--...--> ───────────────────────────────────────
        if (line.slice(lt + 1, lt + 4) === "!--") {
          const comEnd = line.indexOf("-->", lt + 4);
          if (comEnd !== -1) {
            i = comEnd + 3;
            continue;
          }
          // Multi-line comment
          state = State.COMMENT;
          break;
        }

        // ── 4. CDATA section: <![CDATA[...]]> ────────────────────────────
        if (line.slice(lt + 1, lt + 9) === "![CDATA[") {
          const cdataEnd = line.indexOf("]]>", lt + 9);
          if (cdataEnd !== -1) {
            i = cdataEnd + 3;
            continue;
          }
          // Multi-line CDATA
          state = State.CDATA;
          break;
        }

        // ── 5. DOCTYPE: <!DOCTYPE...> (case-insensitive) ─────────────────
        if (
          line.length > lt + 9 &&
          line.slice(lt + 1, lt + 9).toLowerCase() === "!doctype"
        ) {
          const gt = findTagEnd(line, lt + 1);
          if (gt !== -1) {
            i = gt + 1;
            continue;
          }
          // Multi-line DOCTYPE
          state = State.DOCTYPE;
          break;
        }

        // ── 6. Standard tag: <name ... > or <name ... /> ─────────────────
        const gt = findTagEnd(line, lt + 1);
        if (gt !== -1) {
          const content = line.slice(lt + 1, gt);
          const trimmed = content.trim();
          const tagName = extractTagName(trimmed);
          const selfClosing = isSelfClosing(trimmed);

          if (selfClosing) {
            entries.push({
              type: "element",
              depth: elementStack.length,
              text: formatTag(tagName, trimmed, true),
              lineNumber: ln,
              endLine: ln,
            });
          } else {
            elementStack.push({
              tagName,
              depth: elementStack.length,
              startLine: ln,
              text: formatTag(tagName, trimmed, false),
            });
          }
          i = gt + 1;
          continue;
        }

        // Tag spans multiple lines (no `>` found)
        accum = line.slice(lt + 1);
        accumStart = ln;
        state = State.TAG_OPEN;
        break;
      }
    }
    //
    // ── Multi-line state continuations ─────────────────────────────────────
    //

    // ── TAG_OPEN: accumulating a tag across lines, looking for `>` ─────
    else if (state === State.TAG_OPEN) {
      const gt = findTagEnd(line, 0);
      if (gt !== -1) {
        // Tag closes on this line — collapse multi-line attributes with space
        const fullContent = accum + " " + line.slice(0, gt);
        const trimmed = fullContent.trim();
        // Check if this is a close tag by looking for leading / in accum
        const isClose = accum.trimStart().startsWith("/");
        const tagName = extractTagName(trimmed);

        if (isClose) {
          // Close tag that spans lines: </foo\n  attr="val">
          for (let si = elementStack.length - 1; si >= 0; si--) {
            if (elementStack[si].tagName === tagName) {
              const elem = elementStack.splice(si, 1)[0];
              entries.push({
                type: "element",
                depth: elem.depth,
                text: elem.text,
                lineNumber: elem.startLine,
                endLine: ln,
              });
              break;
            }
          }
        } else if (isSelfClosing(trimmed)) {
          entries.push({
            type: "element",
            depth: elementStack.length,
            text: formatTag(tagName, trimmed, true),
            lineNumber: accumStart,
            endLine: ln,
          });
        } else {
          elementStack.push({
            tagName,
            depth: elementStack.length,
            startLine: accumStart,
            text: formatTag(tagName, trimmed, false),
          });
        }

        accum = "";
        state = State.TEXT;

        // Process remainder of this line after `>` as TEXT
        const rest = line.slice(gt + 1);
        if (rest.length > 0) {
          savedLine = rest;
          savedLineno = ln;
        }
      } else {
        // Tag continues to next line — collapse with space
        accum += " " + line;
      }
    }

    // ── COMMENT: scanning for `-->` ─────────────────────────────────────
    else if (state === State.COMMENT) {
      const end = line.indexOf("-->");
      if (end !== -1) {
        state = State.TEXT;
        const rest = line.slice(end + 3);
        if (rest.length > 0) {
          savedLine = rest;
          savedLineno = ln;
        }
      }
    }

    // ── CDATA: scanning for `]]>` ───────────────────────────────────────
    else if (state === State.CDATA) {
      const end = line.indexOf("]]>");
      if (end !== -1) {
        state = State.TEXT;
        const rest = line.slice(end + 3);
        if (rest.length > 0) {
          savedLine = rest;
          savedLineno = ln;
        }
      }
    }

    // ── PI: scanning for `?>`, accumulating content across lines ───────
    else if (state === State.PI) {
      const end = line.indexOf("?>");
      if (end !== -1) {
        const content = accum + "\n" + line.slice(0, end);
        if (elementStack.length === 0) {
          entries.push({
            type: "processing_instruction",
            depth: 0,
            text: formatPI(content),
            lineNumber: accumStart,
            endLine: ln,
          });
        }
        accum = "";
        state = State.TEXT;
        const rest = line.slice(end + 2);
        if (rest.length > 0) {
          savedLine = rest;
          savedLineno = ln;
        }
      } else {
        accum += "\n" + line;
      }
    }

    // ── DOCTYPE: scanning for `>` ──────────────────────────────────────
    else if (state === State.DOCTYPE) {
      const gt = findTagEnd(line, 0);
      if (gt !== -1) {
        state = State.TEXT;
        const rest = line.slice(gt + 1);
        if (rest.length > 0) {
          savedLine = rest;
          savedLineno = ln;
        }
      }
    }
  }

  // ── EOF: close any remaining unclosed elements ──────────────────────────
  while (elementStack.length > 0) {
    const elem = elementStack.pop();
    entries.push({
      type: "element",
      depth: elem.depth,
      text: elem.text,
      lineNumber: elem.startLine,
      endLine: totalLines,
    });
  }

  // Sort by startLine then depth for same-line entries (parent before child)
  entries.sort((a, b) => a.lineNumber - b.lineNumber || a.depth - b.depth);

  return entries;
}
