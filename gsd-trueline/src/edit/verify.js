// ==============================================================================
// Hash-verified Edit Validation
// ==============================================================================
// Ported from trueline-mcp's shared.ts to clean ESM JavaScript.
//
// This module provides edit validation and checksum verification functions
// for the hash-verified streaming edit engine. All functions are pure —
// no I/O, no side effects.

import { parseRange, parseChecksum, BARE_LINE_HASH, parseInlineRef } from "../common/parse.js";
import { fnv1aHash, foldHash, checksumToLetters, hashToLetters, EMPTY_FILE_CHECKSUM, FNV_OFFSET_BASIS } from "../common/hash.js";

// ==============================================================================
// JSDoc Type Definitions
// ==============================================================================

/**
 * Raw edit input as provided by the agent to the edit tool.
 *
 * @typedef {Object} EditInput
 * @property {string} ref - Checksum ref from read/search output (e.g. "aj.9-na.10:abcdef").
 *   Proves the agent is working from actual file content, not hallucinated lines.
 * @property {string} range - Range of lines to edit, expressed as hash.line references
 *   from read/search output (e.g. "gh.12-yz.21" for replace, "+ab.5" for insert-after).
 * @property {string} content - Replacement text (for replace) or text to insert (for insert_after).
 * @property {("replace"|"insert_after")} action - Whether to replace existing lines
 *   or insert content after the specified line.
 */

/**
 * Parsed and validated edit operation ready for the streaming engine.
 *
 * @typedef {Object} StreamEditOp
 * @property {number} startLine - 1-indexed start line of the edit range (0 for prepend).
 * @property {number} endLine - 1-indexed end line of the edit range (same as startLine for insert_after, 0 for prepend).
 * @property {boolean} insertAfter - true if this is an insert_after operation.
 * @property {string} content - The replacement or insertion content string.
 * @property {number} refStartLine - Start line covered by the ref checksum (from ref token).
 * @property {number} refEndLine - End line covered by the ref checksum (from ref token).
 * @property {string} refChecksum - Expected 6-letter checksum from the ref token.
 * @property {string|undefined} startHash - Expected 2-letter boundary hash for the start line.
 *   undefined when start uses BARE_LINE_HASH (bare number like "42").
 * @property {string|undefined} endHash - Expected 2-letter boundary hash for the end line.
 *   undefined when end uses BARE_LINE_HASH.
 */

/**
 * Result of a checksum verification.
 *
 * @typedef {Object} ChecksumResult
 * @property {boolean} valid - Whether the checksum matches.
 * @property {string} [error] - Human-readable error message (present when valid is false).
 * @property {string} [computedChecksum] - The computed 6-letter checksum (present when computation succeeded).
 */

/**
 * Result of a boundary hash verification.
 *
 * @typedef {Object} BoundaryHashResult
 * @property {boolean} valid - Whether the hash matches.
 * @property {string} [error] - Human-readable error message (present when valid is false).
 * @property {string} [actualHash] - The computed 2-letter hash tag.
 */

/**
 * Result of edit validation.
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether all edits pass structural validation.
 * @property {string[]} errors - Array of human-readable error messages (empty when valid).
 * @property {StreamEditOp[]} ops - Parsed and validated edit operations (empty when not valid).
 */

// ==============================================================================
// validateEdits
// ==============================================================================

/**
 * Validate a batch of edit operations structurally without performing any I/O.
 *
 * Validation checks performed in order (short-circuits per-edit on first error):
 *
 * 1. **Edit object validity** — Each entry must be a non-null object with string
 *    ref, range, content, and a valid action ("replace" | "insert_after").
 * 2. **Range parsing** — Delegates to `parseRange` for format validation.
 * 3. **Action/range consistency** — "insert_after" requires "+" range prefix;
 *    "replace" must NOT have "+" prefix.
 * 4. **Line 0 constraint** — Line 0 is only valid for "insert_after" (+0 prepend).
 *    A replace targeting line 0 is rejected.
 * 5. **Ref parsing** — Delegates to `parseChecksum` to validate the ref token format.
 * 6. **Ref coverage** — The ref checksum range must be ≤ the edit start line and
 *    ≥ the edit end line (i.e., ref must cover at least the edit range).
 * 7. **Content size limit** — Replacement/insertion content must not exceed
 *    `maxContentLines` lines.
 * 8. **Hash.line leak detection** — Flags if the content contains strings that
 *    look like hash.line references (e.g. "ab.12"), which suggests the agent
 *    accidentally included read output in the content parameter.
 *
 * After per-edit validation, cross-edit checks run:
 *
 * 9. **Overlapping replace detection** — No two replace ops may have overlapping
 *    line ranges; they cannot be streamed in a single pass.
 * 10. **Insert-after in replace range** — An insert_after targeting a line that
 *     falls inside an active replace range is rejected; the replace consumes those lines.
 *
 * @param {EditInput[]} edits - Array of edit operations to validate.
 * @param {number} [maxContentLines=200] - Maximum allowed lines in replacement content.
 * @returns {ValidationResult}
 */
export function validateEdits(edits, maxContentLines = 200) {
  /** @type {string[]} */
  const errors = [];
  /** @type {StreamEditOp[]} */
  const ops = [];

  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      valid: false,
      errors: ["No edits provided — must be a non-empty array of edit operations."],
      ops: [],
    };
  }

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];

    // ── Edit object validity ────────────────────────────────────────────────
    if (!edit || typeof edit !== "object") {
      errors.push(`Edit ${i}: invalid edit object — must be an object with ref, range, content, and action.`);
      continue;
    }

    // ── Action validation ───────────────────────────────────────────────────
    if (!edit.action || (edit.action !== "replace" && edit.action !== "insert_after")) {
      errors.push(
        `Edit ${i}: invalid action "${String(edit.action)}" — must be "replace" or "insert_after".`,
      );
      continue;
    }

    // ── Required fields ─────────────────────────────────────────────────────
    if (typeof edit.ref !== "string" || edit.ref.length === 0) {
      errors.push(`Edit ${i}: missing or empty ref — copy a ref token from read/search output.`);
      continue;
    }

    if (typeof edit.range !== "string" || edit.range.length === 0) {
      errors.push(`Edit ${i}: missing or empty range — supply a range like "ab.12" or "ab.12-cd.34".`);
      continue;
    }

    if (typeof edit.content !== "string") {
      errors.push(`Edit ${i}: content must be a string.`);
      continue;
    }

    // ── Range parsing ───────────────────────────────────────────────────────
    let parsedRange;
    try {
      parsedRange = parseRange(edit.range);
    } catch (e) {
      errors.push(`Edit ${i}: invalid range "${edit.range}" — ${/** @type {Error} */ (e).message}`);
      continue;
    }

    const { start, end, insertAfter: rangeInsertAfter } = parsedRange;

    // ── Action/range consistency ────────────────────────────────────────────
    if (edit.action === "insert_after" && !rangeInsertAfter) {
      errors.push(
        `Edit ${i}: action is "insert_after" but range "${edit.range}" is not a single-line target. ` +
          'Use "+ab.5" syntax for insert-after.',
      );
      continue;
    }

    if (edit.action === "replace" && rangeInsertAfter) {
      errors.push(
        `Edit ${i}: action is "replace" but range "${edit.range}" uses insert-after (+). ` +
          'Use "ab.5" or "ab.5-cd.10" for replace ranges.',
      );
      continue;
    }

    // ── Line 0 constraint ───────────────────────────────────────────────────
    if (start.line === 0) {
      if (edit.action !== "insert_after") {
        errors.push(
          `Edit ${i}: line 0 is only valid for insert_after (+0) — use "+0" to prepend content at the start of the file.`,
        );
        continue;
      }
      // Line 0 insert_after (+0) is valid — this is a prepend operation
    }

    // ── Ref parsing ─────────────────────────────────────────────────────────
    let checksumRef;
    try {
      checksumRef = parseChecksum(edit.ref);
    } catch (e) {
      errors.push(
        `Edit ${i}: invalid ref "${edit.ref}" — ${/** @type {Error} */ (e).message}. ` +
          "Copy a fresh ref token from read/search output.",
      );
      continue;
    }

    // ── Ref coverage check ──────────────────────────────────────────────────
    if (!refCoversEdit(start.line, end.line, checksumRef.startLine, checksumRef.endLine)) {
      errors.push(
        `Edit ${i}: ref range ${checksumRef.startLine}-${checksumRef.endLine} does not cover edit range ` +
          `${start.line}-${end.line}. The ref token covers fewer lines than the edit targets. ` +
          "Re-read a larger range to get a ref that covers the edit target.",
      );
      continue;
    }

    // ── Content size check ──────────────────────────────────────────────────
    const contentLines = edit.content.split("\n");
    if (contentLines.length > maxContentLines) {
      errors.push(
        `Edit ${i}: content is ${contentLines.length} lines, which exceeds the limit of ${maxContentLines} lines. ` +
          "Split the edit into smaller chunks.",
      );
      continue;
    }

    // ── Hash.line leak detection ────────────────────────────────────────────
    const leakedHashes = findLeakedHashLines(edit.content);
    if (leakedHashes.length > 0) {
      const snippet = leakedHashes.slice(0, 3).map((h) => `"${h}"`).join(", ");
      errors.push(
        `Edit ${i}: content appears to contain ${leakedHashes.length} hash.line reference(s) ` +
          `(${snippet}${leakedHashes.length > 3 ? ", ..." : ""}) ` +
          "that look like hash tags from read output. Hash.line references should only appear in the " +
          "range parameter, not in the replacement content. " +
          "Did you accidentally include read output in the content?",
      );
      continue;
    }

    // ── Build StreamEditOp ──────────────────────────────────────────────────
    ops.push({
      startLine: start.line,
      endLine: end.line,
      insertAfter: edit.action === "insert_after",
      content: edit.content,
      refStartLine: checksumRef.startLine,
      refEndLine: checksumRef.endLine,
      refChecksum: checksumRef.hash,
      startHash: start.hash !== BARE_LINE_HASH ? start.hash : undefined,
      endHash: end.hash !== BARE_LINE_HASH ? end.hash : undefined,
    });
  }

  // ── Cross-edit: overlapping replace detection ─────────────────────────────
  const replaceOps = ops.filter((op) => !op.insertAfter);
  for (let i = 0; i < replaceOps.length; i++) {
    for (let j = i + 1; j < replaceOps.length; j++) {
      const a = replaceOps[i];
      const b = replaceOps[j];
      if (rangesOverlap(a.startLine, a.endLine, b.startLine, b.endLine)) {
        errors.push(
          `Replace ops overlap: edit targeting lines ${a.startLine}-${a.endLine} overlaps with ` +
            `edit targeting lines ${b.startLine}-${b.endLine}. Overlapping replace edits cannot be ` +
            "applied in a single pass. Apply them sequentially or adjust the ranges to be non-overlapping.",
        );
      }
    }
  }

  // ── Cross-edit: insert_after inside replace range ─────────────────────────
  for (const repOp of replaceOps) {
    for (const insOp of ops) {
      if (insOp.insertAfter && insOp.startLine >= repOp.startLine && insOp.startLine <= repOp.endLine) {
        errors.push(
          `Insert-after at line ${insOp.startLine} falls inside replace range ` +
            `${repOp.startLine}-${repOp.endLine}. Insert-after inside a replace range is not supported. ` +
            "Adjust ranges so insert-after targets are outside replace ranges.",
        );
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, ops: [] };
  }

  return { valid: true, errors: [], ops };
}

// ==============================================================================
// verifyChecksum
// ==============================================================================

/**
 * Verify that the checksum of a set of lines matches the expected ref checksum.
 *
 * Computes the FNV-1a checksum over the provided lines by:
 * 1. Computing `fnv1aHash` of each line's content.
 * 2. Folding each 32-bit hash into the accumulator via `foldHash`.
 * 3. Converting the final accumulator to a 6-letter checksum via `checksumToLetters`.
 * 4. Comparing against the expected hash from the ref token.
 *
 * Handles the empty-file sentinel (`0-0:aaaaaa`) and detects truncated files
 * (fewer lines provided than the ref range expects).
 *
 * @param {string[]} lines - Array of line strings (without trailing newline characters).
 * @param {string} refRange - The ref checksum string (e.g. "aj.9-na.10:abcdef", "0-0:aaaaaa",
 *   or with a "checksum: " / "ref: " prefix).
 * @returns {ChecksumResult}
 */
export function verifyChecksum(lines, refRange) {
  // Parse the checksum ref
  let ref;
  try {
    ref = parseChecksum(refRange);
  } catch (e) {
    return { valid: false, error: `Invalid ref format: ${/** @type {Error} */ (e).message}` };
  }

  const { startLine, endLine, hash: expectedHash } = ref;

  // Handle empty-file sentinel (0-0:aaaaaa)
  if (startLine === 0 && endLine === 0) {
    if (lines.length === 0) {
      return { valid: true, computedChecksum: "aaaaaa" };
    }
    return {
      valid: false,
      error:
        `Ref indicates an empty file (${EMPTY_FILE_CHECKSUM}) but ${lines.length} line(s) were provided. ` +
        "The file has gained content since the ref was issued. Re-read the file to get a fresh ref.",
    };
  }

  // Detect truncated file: fewer lines than ref expects
  const expectedLineCount = endLine - startLine + 1;
  if (lines.length < expectedLineCount) {
    return {
      valid: false,
      error:
        `Truncated content: ref expects ${expectedLineCount} line${expectedLineCount !== 1 ? "s" : ""} ` +
        `(lines ${startLine}-${endLine}) but only ${lines.length} line(s) were provided. ` +
        "The file may have been truncated since the ref was issued. " +
        "Re-read the file to get a fresh ref.",
    };
  }

  // Compute checksum: fold each line's FNV-1a hash into the accumulator
  let accumulator = FNV_OFFSET_BASIS;
  for (const line of lines) {
    const h = fnv1aHash(line);
    accumulator = foldHash(accumulator, h);
  }

  const computedChecksum = checksumToLetters(accumulator);

  // Compare against expected
  if (computedChecksum !== expectedHash) {
    return {
      valid: false,
      error:
        `Checksum mismatch: expected "${expectedHash}" but computed "${computedChecksum}" ` +
        `(range ${startLine}-${endLine}, ${lines.length} line${lines.length !== 1 ? "s" : ""}). ` +
        "The file content has changed since the ref was issued. " +
        "Re-read the file to get a fresh ref.",
      computedChecksum,
    };
  }

  return { valid: true, computedChecksum };
}

// ==============================================================================
// verifyBoundaryHash
// ==============================================================================

/**
 * Verify that a line's FNV-1a content hash matches the expected 2-letter tag.
 *
 * Computes `fnv1aHash` of the line content, converts to a 2-letter tag via
 * `hashToLetters`, and compares against the expected tag. Provides a
 * human-readable error message identifying the line number, expected hash,
 * and computed hash — with an actionable remediation suggestion.
 *
 * @param {string} lineContent - The actual content of the line to verify.
 * @param {string} expectedHash - The expected 2-letter hash tag (e.g. "ab").
 * @param {number} lineNumber - The 1-indexed line number (used in error messages).
 * @returns {BoundaryHashResult}
 */
export function verifyBoundaryHash(lineContent, expectedHash, lineNumber) {
  const lineHash = fnv1aHash(lineContent);
  const actualHash = hashToLetters(lineHash);

  if (actualHash !== expectedHash) {
    return {
      valid: false,
      error:
        `Boundary hash mismatch at line ${lineNumber}: expected hash tag "${expectedHash}" ` +
        `but computed "${actualHash}". The content at line ${lineNumber} differs from what the ` +
        "ref was issued for. The file may have been modified since the last read. " +
        "Re-read the file with trueline_read to get a fresh ref.",
      actualHash,
    };
  }

  return { valid: true, actualHash };
}

// ==============================================================================
// Internal helpers
// ==============================================================================

/**
 * Check whether the ref's checksum range covers the edit range.
 *
 * The ref range must start at or before the edit start line, and end at or
 * after the edit end line. For prepend operations (startLine === 0), the ref
 * must also start at 0 (empty file sentinel).
 *
 * @param {number} editStart - Start line of the edit range.
 * @param {number} editEnd - End line of the edit range.
 * @param {number} refStart - Start line of the ref checksum range.
 * @param {number} refEnd - End line of the ref checksum range.
 * @returns {boolean} true if ref covers edit.
 */
function refCoversEdit(editStart, editEnd, refStart, refEnd) {
  // Prepend (line 0) requires ref to also start at 0
  if (editStart === 0) {
    return refStart === 0;
  }
  // Normal case: ref must start <= edit start and end >= edit end
  return refStart <= editStart && refEnd >= editEnd;
}

/**
 * Check whether two inclusive ranges overlap.
 *
 * Overlap occurs when range A's start ≤ range B's end AND range B's start
 * ≤ range A's end.
 *
 * @param {number} aStart
 * @param {number} aEnd
 * @param {number} bStart
 * @param {number} bEnd
 * @returns {boolean} true if the ranges overlap.
 */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Extract suspected hash.line references from content.
 *
 * Scans for the pattern `[a-z]{2}.\d+` (e.g. "ab.12") which looks like
 * a hash tag paired with a line number — likely accidentally included
 * read output in the replacement content.
 *
 * @param {string} content - The content to scan.
 * @returns {string[]} List of matching substrings found.
 */
function findLeakedHashLines(content) {
  const pattern = /[a-z]{2}\.\d+/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    matches.push(match[0]);
  }
  return matches;
}
