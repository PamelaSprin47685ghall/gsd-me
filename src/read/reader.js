// ==============================================================================
// gsd-trueline — hash-verified streaming reader with range support
//
// Streams a file line-by-line via `splitLines` — the file is never loaded
// into memory as a whole. Supports reading multiple disjoint ranges in a
// single call, each producing its own inline ref.
//
// Output is assembled as raw byte buffers (line prefixes are ASCII, line
// content stays as the original bytes) and decoded to a string once at the
// end. This avoids a per-line `Buffer.toString()` allocation.
// ==============================================================================
// Ported from trueline-mcp's tools/read.ts to plain ESM JavaScript.

import { splitLines } from "./line-splitter.js";
import {
  FNV_OFFSET_BASIS,
  fnv1aHashBytes,
  foldHash,
  hashToLetters,
  checksumToLetters,
} from "../common/hash.js";
import { parseRanges, parseFilePathWithRanges } from "../common/parse.js";
import { validatePath, expandGlobs, displayPath, errorResult } from "../common/security.js";

// ==============================================================================
// Constants
// ==============================================================================

/** Buffer containing a single LF byte (\n). */
const LF = Buffer.from("\n");

/** Maximum number of output lines before truncation. */
const MAX_OUTPUT_LINES = 2000;

/** Maximum output size in bytes before truncation (20 MB). */
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

/** Full-file reads above this line count get a nudge to use ranges. */
const LARGE_READ_NUDGE = 150;

// ==============================================================================
// Helpers
// ==============================================================================

/**
 * @typedef {Object} ToolResult
 * @property {Array<{type: string, text: string}>} content
 * @property {boolean} [isError]
 */

/**
 * Create a successful text ToolResult.
 * @param {string} text
 * @returns {ToolResult}
 */
export function textResult(text) {
  return { content: [{ type: "text", text }] };
}

/**
 * Expand each range by 1 line on each side for boundary context, then re-merge.
 *
 * Whole-file ranges (end === Infinity) are not expanded.
 * Boundary at line 1 never expands backward past line 1.
 *
 * @param {{ start: number, end: number }[]} ranges
 * @returns {{ start: number, end: number }[]}
 */
function expandRanges(ranges) {
  const expanded = ranges.map((r) => ({
    start: r.start > 1 && r.end !== Infinity ? r.start - 1 : r.start,
    end: r.end !== Infinity ? r.end + 1 : r.end,
  }));
  // Merge overlapping or adjacent expanded ranges
  for (let i = 1; i < expanded.length; i++) {
    const prev = expanded[i - 1];
    const curr = expanded[i];
    if (prev.end === Infinity || curr.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, curr.end);
      expanded.splice(i, 1);
      i--;
    }
  }
  return expanded;
}

// ==============================================================================
// handleRead — Read a single file with optional ranges
// ==============================================================================

/**
 * @typedef {Object} ReadParams
 * @property {string} file_path
 * @property {string} [encoding]
 * @property {string[]} [ranges]
 * @property {string} [projectDir]
 * @property {string[]} [allowedDirs]
 */

/**
 * Stream a file through splitLines, compute per-line FNV-1a hashes,
 * output "hash.line\tcontent" for each line in the requested ranges,
 * and emit ref tokens at range boundaries.
 *
 * @param {ReadParams} params
 * @returns {Promise<ToolResult>}
 */
export async function handleRead(params) {
  const { file_path, projectDir, allowedDirs } = params;

  // 1. Validate path via validatePath (from security.js)
  const validated = await validatePath(file_path, "Read", projectDir, allowedDirs);
  if (!validated.ok) return validated.error;

  const { resolvedPath } = validated;

  // 2. Parse ranges via parseRanges (from parse.js) — default whole-file if none specified
  /** @type {{ start: number, end: number }[]} */
  let ranges;
  try {
    ranges = parseRanges(params.ranges);
  } catch (err) {
    return errorResult(/** @type {Error} */ (err).message);
  }

  // Save the original (unexpanded) ranges for nudge/out-of-range logic
  const requestedRanges = ranges;

  // 3. Expand ranges by 1 on each side for boundary context, then re-merge
  ranges = expandRanges(ranges);

  // 4. Stream via splitLines with binary detection
  const outputChunks = [];
  let outputLen = 0;
  let rangeIdx = 0;
  let currentRange = ranges[0];
  let rangeChecksumHash = FNV_OFFSET_BASIS;
  let rangeFirstLine = 0;
  let rangeLastLine = 0;
  let rangeFirstLetters = "";
  let rangeLastLetters = "";
  let totalLines = 0;
  let outputLines = 0;
  let truncated = false;

  try {
    for await (const { lineBytes, lineNumber } of splitLines(resolvedPath, { detectBinary: true })) {
      totalLines = lineNumber;

      // Past all ranges — stop early
      if (rangeIdx >= ranges.length) break;

      currentRange = ranges[rangeIdx];

      // Before current range
      if (lineNumber < currentRange.start) continue;

      // Past current range — close it, advance to next
      if (lineNumber > currentRange.end) {
        // Emit ref token for the completed range
        if (rangeFirstLine > 0 && rangeLastLine > 0) {
          const ck = checksumToLetters(rangeChecksumHash);
          const refLine = `\nref: ${rangeFirstLetters}.${rangeFirstLine}-${rangeLastLetters}.${rangeLastLine}:${ck}\n`;
          const cb = Buffer.from(refLine);
          outputChunks.push(cb);
          outputLen += cb.length;
        }

        rangeIdx++;
        rangeChecksumHash = FNV_OFFSET_BASIS;
        rangeFirstLine = 0;
        rangeLastLine = 0;
        rangeFirstLetters = "";
        rangeLastLetters = "";

        // Check if new range starts at this line
        if (rangeIdx >= ranges.length) break;
        currentRange = ranges[rangeIdx];
        if (lineNumber < currentRange.start) continue;
      }

      // Within current range — hash and output
      const h = fnv1aHashBytes(lineBytes, 0, lineBytes.length);
      const letters = hashToLetters(h);
      if (rangeFirstLine === 0) {
        rangeFirstLine = lineNumber;
        rangeFirstLetters = letters;
      }

      const prefix = Buffer.from(`${letters}.${lineNumber}\t`);
      const lineLen = prefix.length + lineBytes.length + 1; // +1 for LF

      // Enforce output limits before committing this line
      outputLines++;
      if (outputLines > MAX_OUTPUT_LINES || outputLen + lineLen > MAX_OUTPUT_BYTES) {
        truncated = true;
        break;
      }

      rangeLastLine = lineNumber;
      rangeLastLetters = letters;
      rangeChecksumHash = foldHash(rangeChecksumHash, h);
      outputChunks.push(prefix, lineBytes, LF);
      outputLen += lineLen;
    }
  } catch (err) {
    // Convert binary detection error from splitLines into a clear tool result
    if (/** @type {Error} */ (err).message === "File appears to be binary (contains null bytes)") {
      return errorResult(`"${file_path}" is a binary file — use with caution`);
    }
    throw err;
  }

  // ============================================================================
  // Post-stream handling
  // ============================================================================

  // Empty file returns "(empty file)\n\nref: 0-0:aaaaaa"
  if (totalLines === 0 && !truncated) {
    return textResult("(empty file)\n\nref: 0-0:aaaaaa");
  }

  // Check if first range's start is out of range
  if (rangeFirstLine === 0 && ranges.length > 0 && ranges[0].start > totalLines) {
    return errorResult(`start_line ${ranges[0].start} out of range (file has ${totalLines} lines)`);
  }

  // Emit ref for the last range (only if we output any lines in it)
  if (rangeFirstLine > 0 && rangeLastLine > 0) {
    const ck = checksumToLetters(rangeChecksumHash);
    const refLine = `\nref: ${rangeFirstLetters}.${rangeFirstLine}-${rangeLastLetters}.${rangeLastLine}:${ck}`;
    const cb = Buffer.from(refLine);
    outputChunks.push(cb);
    outputLen += cb.length;
  }

  // Append truncation notice so the agent knows to use narrower ranges
  if (truncated) {
    const reason = outputLines > MAX_OUTPUT_LINES ? `${MAX_OUTPUT_LINES} line` : "20 MB output";
    const notice = `\n\n(truncated at ${reason} limit — use ranges for specific sections)`;
    const nb = Buffer.from(notice);
    outputChunks.push(nb);
    outputLen += nb.length;
  }

  // Nudge toward targeted reads when a full-file read returns many lines
  const isFullFileRead = requestedRanges.length === 1 && requestedRanges[0].end === Infinity;
  if (!truncated && isFullFileRead && outputLines > LARGE_READ_NUDGE) {
    const nudge = Buffer.from(`\n\n(${outputLines} lines — consider ranges for targeted reads)`);
    outputChunks.push(nudge);
    outputLen += nudge.length;
  }

  return textResult(Buffer.concat(outputChunks, outputLen).toString("utf-8"));
}

// ==============================================================================
// handleReadMulti — Read multiple files with glob expansion and inline ranges
// ==============================================================================

/**
 * @typedef {Object} ReadMultiParams
 * @property {string[]} file_paths
 * @property {string} [encoding]
 * @property {string[]} [ranges]
 * @property {string} [projectDir]
 * @property {string[]} [allowedDirs]
 */

/**
 * Read multiple files, expanding globs and parsing inline ranges
 * from file_paths (e.g. "foo.ts:10-25"). Dispatches each to handleRead
 * and collects results. Per-file errors are skipped in multi-file mode
 * so one bad glob doesn't abort the batch.
 *
 * @param {ReadMultiParams} params
 * @returns {Promise<ToolResult>}
 */
export async function handleReadMulti(params) {
  const { file_paths, ranges, ...rest } = params;

  // Expand globs before parsing inline ranges (globs never contain ':')
  const expanded = await expandGlobs(file_paths, rest.projectDir);

  // Parse inline ranges from file_paths (e.g. "src/foo.ts:10-25")
  const parsed = expanded.map(parseFilePathWithRanges);

  // Top-level ranges with multiple files is ambiguous; reject it
  if (ranges && ranges.length > 0 && parsed.length > 1) {
    return errorResult(
      "Top-level ranges cannot be used with multiple file_paths. " +
        'Use inline range syntax instead: file_paths: ["src/foo.ts:10-25", "src/bar.ts:1-50"]',
    );
  }

  // Single file: top-level ranges still work for backward compat
  if (parsed.length === 1) {
    const fp = parsed[0];
    const effectiveRanges = fp.rangeSpecs ?? ranges;
    return handleRead({ ...rest, file_path: fp.path, ranges: effectiveRanges });
  }

  // Multiple files: skip per-file errors so one bad path doesn't abort batch
  const parts = [];
  for (const fp of parsed) {
    const result = await handleRead({ ...rest, file_path: fp.path, ranges: fp.rangeSpecs });
    const text = result.content[0].text;
    if (result.isError) {
      parts.push(`--- ${displayPath(fp.path, rest.projectDir)} ---\nerror: ${text}`);
      continue;
    }
    parts.push(`--- ${displayPath(fp.path, rest.projectDir)} ---\n${text}`);
  }
  return textResult(parts.join("\n\n"));
}
