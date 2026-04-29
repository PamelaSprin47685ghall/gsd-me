// ==============================================================================
// gsd-trueline — Smart dispatch layer for outline mode
//
// Routes read(path) without offset/limit/ranges to the appropriate outline
// engine based on file extension. Unsupported file types return null so the
// caller falls back to hash-verified full content reading.
//
// Multi-file dispatch (handleOutlineMulti) processes each file independently
// with per-file error tolerance — one bad file doesn't abort the batch.
// ==============================================================================

import { splitLines } from "./line-splitter.js";
import { validatePath, errorResult } from "../common/security.js";
import { parseFilePathWithRanges } from "../common/parse.js";
import {
  getExtension,
  extractCodeOutline,
} from "./outline.js";
import { extractMarkdownOutline } from "./outline-markdown.js";
import { extractXmlOutline } from "./outline-xml.js";

// ==============================================================================
// Line counter (streaming — never loads full file into memory)
// ==============================================================================

/**
 * Count the total number of lines in a file via streaming.
 *
 * @param {string} filePath
 * @returns {Promise<number>}
 */
async function countFileLines(filePath) {
  let count = 0;
  for await (const { lineNumber } of splitLines(filePath)) {
    count = lineNumber;
  }
  return count;
}

// ==============================================================================
// Extension routing
// ==============================================================================

/** Regex for file extensions that use markdown outline. */
const MARKDOWN_EXT_RE = /^\.(md|markdown)$/i;

/** Regex for file extensions that use XML outline. */
const XML_EXT_RE = /^\.(xml|xsl|xslt|svg|xhtml|pom|csproj|props|targets|fxml|xaml)$/i;

/** Regex for file extensions that use code outline. */
const CODE_EXT_RE = /^\.(js|mjs|cjs|ts|tsx|py|go|rs|java|c|h|cpp|hpp|cc|cxx)$/i;

// ==============================================================================
// Shared formatOutline — used by all three outline engines
// ==============================================================================

/**
 * Format outline entries into a compact readable string.
 *
 * Handles both code outline entries ({startLine, endLine, nodeType, text})
 * and markdown/XML outline entries ({lineNumber, endLine, type, text}).
 *
 * Produces output like:
 * ```
 * 1-10: (10 imports)
 * 25-25: function foo(bar) {
 * 33-33: class Bar {
 * (2 symbols, 150 source lines)
 * ```
 *
 * @param {Array} entries - Outline entries from any engine.
 * @param {number} totalLines - Total source lines in the file.
 * @returns {string}
 */
export function formatOutline(entries, totalLines) {
  if (!entries || entries.length === 0) {
    return `(0 symbols, ${totalLines} source lines)`;
  }

  const lines = entries.map((e) => {
    const start = e.startLine ?? e.lineNumber;
    const end = e.endLine ?? start;
    const range = start === end ? `${start}` : `${start}-${end}`;
    return `${range}: ${e.text}`;
  });

  // Count non-skipGroup entries as "symbols"
  const symbolCount = entries.filter((e) => {
    const type = e.nodeType ?? e.type;
    return type !== "skipGroup";
  }).length;

  lines.push(`(${symbolCount} symbols, ${totalLines} source lines)`);
  return lines.join("\n");
}

// ==============================================================================
// Single-file outline dispatch
// ==============================================================================

/**
 * @typedef {Object} OutlineParams
 * @property {string} file_path
 * @property {string} [projectDir]
 * @property {string[]} [allowedDirs]
 */

/**
 * Attempt to produce a structural outline for a single file.
 *
 * Returns a ToolResult on success, error ToolResult on validation failure,
 * or null if the file extension is unsupported (caller falls back to handleRead).
 *
 * @param {OutlineParams} params
 * @returns {Promise<{content: Array<{type: string, text: string}>} | {content: Array<{type: string, text: string}>, isError: boolean} | null>
 */
export async function handleOutline(params) {
  const { file_path, projectDir, allowedDirs } = params;

  // 1. Validate path via validatePath
  const validated = await validatePath(file_path, "Read", projectDir, allowedDirs);
  if (!validated.ok) return validated.error;

  const { resolvedPath } = validated;

  // 2. Determine file extension (lowercased)
  const ext = getExtension(resolvedPath);
  if (!ext) return null;

  // 3. Route by extension
  let entries;
  let totalLines;

  if (MARKDOWN_EXT_RE.test(ext)) {
    entries = await extractMarkdownOutline(resolvedPath);
    totalLines = await countFileLines(resolvedPath);
  } else if (XML_EXT_RE.test(ext)) {
    entries = await extractXmlOutline(resolvedPath);
    totalLines = await countFileLines(resolvedPath);
  } else if (CODE_EXT_RE.test(ext)) {
    const result = await extractCodeOutline(resolvedPath);
    entries = result.entries;
    totalLines = result.totalLines;
  } else {
    // Unsupported extension — caller falls back to handleRead
    return null;
  }

  // 4. Format entries via shared formatOutline function
  const text = formatOutline(entries, totalLines);

  // 5. Return ToolResult
  return { content: [{ type: "text", text }] };
}

// ==============================================================================
// Multi-file outline dispatch
// ==============================================================================

/**
 * @typedef {Object} OutlineMultiParams
 * @property {string[]} file_paths
 * @property {string} [projectDir]
 * @property {string[]} [allowedDirs]
 */

/**
 * Attempt to produce outlines for multiple files.
 *
 * Per-file error tolerance: bad files don't abort the batch.
 * If all files lack outline support, returns null (caller falls back).
 *
 * Inline range syntax (e.g. "file.txt:10-25") is stripped before dispatching
 * to outline — ranges only apply to hash-verified reads, not outlines.
 *
 * @param {OutlineMultiParams} params
 * @returns {Promise<{content: Array<{type: string, text: string}>} | null>
 */
export async function handleOutlineMulti(params) {
  const { file_paths, projectDir, allowedDirs } = params;

  const parts = [];
  let anyOutline = false;

  for (const entry of file_paths) {
    // Strip inline range syntax — ranges only apply to hash-verified reads
    const { path } = parseFilePathWithRanges(entry);

    const result = await handleOutline({
      file_path: path,
      projectDir,
      allowedDirs,
    });

    if (result === null) {
      // No outline support for this file — skip silently
      continue;
    }

    if (result.isError) {
      parts.push(`--- ${path} ---\nerror: ${result.content[0].text}`);
      continue;
    }

    anyOutline = true;
    parts.push(`--- ${path} ---\n${result.content[0].text}`);
  }

  if (!anyOutline) return null;

  return { content: [{ type: "text", text: parts.join("\n\n") }] };
}
