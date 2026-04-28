// ==============================================================================
// Protocol-format parsing
// ==============================================================================
// Ported from trueline-mcp's parse.ts to plain ESM JavaScript.

const DECIMAL_INT = /^\d+$/;

/** Sentinel hash for bare line numbers (e.g. "78" instead of "rn.78"). */
export const BARE_LINE_HASH = "??";

/**
 * Parse a `hash.line` reference string like "mp.4".
 *
 * The hash is the 2-letter tag that appears before the line number in
 * hash-verified read / search output. The agent copies it verbatim
 * when constructing the edit range, so the boundary hash travels with
 * the line number naturally.
 *
 * Special case: bare "0" is valid (insert at file start, no hash).
 *
 * @param {string} ref - The hash.line reference string.
 * @returns {{ line: number, hash: string }} Parsed line number and hash.
 */
export function parseHashLine(ref) {
  const dotIdx = ref.indexOf(".");
  if (dotIdx === -1) {
    // No dot — must be bare "0" for insert-at-start
    if (!DECIMAL_INT.test(ref)) {
      throw new Error(
        `Invalid hash.line reference "${ref}" — expected format "hash.line" (e.g. "ab.12"). ` +
          "Copy the 2-letter prefix and line number from read/search output.",
      );
    }
    const line = Number(ref);
    if (line !== 0) {
      return { line, hash: BARE_LINE_HASH };
    }
    return { line: 0, hash: "" };
  }

  const hash = ref.slice(0, dotIdx);
  const lineStr = ref.slice(dotIdx + 1);

  if (!DECIMAL_INT.test(lineStr)) {
    throw new Error(`Invalid line number in "${ref}" — must be a non-negative integer`);
  }

  const line = Number(lineStr);

  if (line === 0) {
    throw new Error(`Invalid hash.line reference "${ref}" — line 0 must use bare "0" with no hash`);
  }
  if (!/^[a-z]{2}$/.test(hash)) {
    if (hash.length > 0) {
      // Wrong format but valid line number — use sentinel
      return { line, hash: BARE_LINE_HASH };
    }
    throw new Error(
      `Invalid hash.line reference "${ref}" — expected format "hash.line" (e.g. "ab.${line}"). ` +
        "Copy the 2-letter prefix and line number from read/search output.",
    );
  }

  return { line, hash };
}

/**
 * Parse a range string into start/end hash.line references.
 *
 * Accepts three forms:
 *   - "gh.12-yz.21"  — explicit start-end range (replace)
 *   - "ab.5"          — single-line shorthand, equivalent to "ab.5-ab.5"
 *   - "+ab.5"         — insert-after line 5 (single-line only)
 *
 * The `+` prefix signals insert-after and is only valid on single-line
 * ranges (no `-`). Throws on invalid format or if start line > end line.
 *
 * @param {string} range - The range string to parse.
 * @returns {{ start: {line: number, hash: string}, end: {line: number, hash: string}, insertAfter: boolean }}
 */
export function parseRange(range) {
  // Detect and strip insert-after prefix
  let insertAfter = false;
  let raw = range;
  if (raw.startsWith("+")) {
    insertAfter = true;
    raw = raw.slice(1);
  }

  // Find "-" separator between two hash.line refs. Since neither hashes
  // ([a-z]{2}) nor line numbers (digits) contain "-", indexOf is unambiguous.
  const dashIdx = raw.indexOf("-");

  if (insertAfter && dashIdx !== -1) {
    throw new Error(
      `Invalid range "${range}" — insert-after (+) requires a single-line target, not a range. Use "+ab.10" to insert after line 10.`,
    );
  }

  if (dashIdx === -1) {
    const ref = parseHashLine(raw);
    return { start: ref, end: { ...ref }, insertAfter };
  }

  const start = parseHashLine(raw.slice(0, dashIdx));
  const end = parseHashLine(raw.slice(dashIdx + 1));

  if (start.line > end.line) {
    throw new Error(
      `Invalid range "${range}" — start line ${start.line} must be ≤ end line ${end.line}. Did you swap start and end?`,
    );
  }

  return { start, end, insertAfter };
}

/**
 * @typedef {Object} ChecksumRef
 * @property {number} startLine
 * @property {number} endLine
 * @property {string} hash
 */

/**
 * Parse a checksum string from hash-verified read or search output.
 *
 * Accepts both the decimal format ("9-10:abcdef") and the hash.line
 * format ("aj.9-na.10:abcdef") as well as mixed and single-line forms.
 * Strips a "checksum: " or "ref: " label prefix and trims whitespace.
 *
 * The special sentinel "0-0:aaaaaa" represents an empty file.
 *
 * @param {string} checksum - The checksum string to parse.
 * @returns {ChecksumRef} Parsed checksum reference.
 */
export function parseChecksum(checksum) {
  // Step 1: Normalize — trim then strip the "checksum: " label if present.
  let raw = checksum.trim();
  if (raw.startsWith("checksum:")) {
    raw = raw.slice("checksum:".length).trimStart();
  } else if (raw.startsWith("ref:")) {
    raw = raw.slice("ref:".length).trimStart();
  }

  // Step 2: Split on the last ":" to separate the range part from the hash.
  // We use lastIndexOf so that dots/letters in hash.line refs don't interfere.
  const colonIdx = raw.lastIndexOf(":");
  if (colonIdx === -1) {
    throw new Error(
      `Invalid checksum "${checksum}" — expected format "startLine-endLine:letters", e.g. "aj.9-na.10:abcdef"`,
    );
  }

  const rangePart = raw.slice(0, colonIdx);
  const hash = raw.slice(colonIdx + 1).toLowerCase();

  if (!/^[a-z]{6}$/.test(hash)) {
    throw new Error(`Invalid checksum "${checksum}" — hash must be 6 lowercase letters, got "${hash}"`);
  }

  // Step 3: Find the dash separating start from end. The first "-" that is
  // immediately preceded by a digit (not a letter) is the range separator.
  const dashIdx = findRangeDash(rangePart);

  let startRef;
  let endRef;

  if (dashIdx === -1) {
    // Single-line reference: start = end.
    startRef = rangePart;
    endRef = rangePart;
  } else {
    startRef = rangePart.slice(0, dashIdx);
    endRef = rangePart.slice(dashIdx + 1);
  }

  const start = extractLineNumber(startRef, checksum, "start");
  const end = extractLineNumber(endRef, checksum, "end");

  const startLine = start.line;
  const endLine = end.line;

  // 0-0 is the empty-file sentinel; any other use of 0 is invalid.
  if (startLine === 0 && endLine !== 0) {
    throw new Error(`Invalid checksum "${checksum}" — startLine 0 requires endLine 0`);
  }
  if (startLine > endLine) {
    throw new Error(`Invalid checksum "${checksum}" — start ${startLine} must be ≤ end ${endLine}`);
  }
  if (startLine === 0 && endLine === 0 && hash !== "aaaaaa") {
    throw new Error(`Invalid checksum "${checksum}" — empty-file sentinel must have hash aaaaaa`);
  }

  /** @type {ChecksumRef} */
  const result = { startLine, endLine, hash };
  return result;
}

/**
 * Parse an inline ref string as emitted by hash-verified read/search output.
 * Delegates to parseChecksum.
 *
 * @param {string} ref - The ref string.
 * @returns {ChecksumRef}
 */
export function parseInlineRef(ref) {
  return parseChecksum(ref);
}

/**
 * Find the index of the "-" that separates the start ref from the end ref.
 *
 * Strategy: scan for the first "-" that is immediately preceded by a digit.
 * In "aj.9-na.10" the separator is at index 4 (after "9").
 * In "9-10" it's at index 1 (after "9").
 * Returns -1 if no range dash is found (single-line reference).
 *
 * @param {string} rangePart - The range portion of a checksum string.
 * @returns {number} Index of the range dash, or -1 if not found.
 */
function findRangeDash(rangePart) {
  for (let i = 1; i < rangePart.length; i++) {
    const c = rangePart.charCodeAt(i - 1);
    if (rangePart[i] === "-" && c >= 48 && c <= 57) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse a single side of a checksum range — either "aj.9" or "9" format.
 * Returns the line number and optional 2-letter hash prefix.
 *
 * @param {string} ref - The ref portion.
 * @param {string} originalInput - The original input for error messages.
 * @param {string} which - "start" or "end" for error messages.
 * @returns {{ line: number, hashPrefix?: string }}
 */
function extractLineNumber(ref, originalInput, which) {
  const dotIdx = ref.indexOf(".");
  if (dotIdx !== -1) {
    // hash.line format: "aj.9"
    const hashPrefix = ref.slice(0, dotIdx).toLowerCase();
    const lineStr = ref.slice(dotIdx + 1);
    if (!/^[a-z]{2}$/.test(hashPrefix)) {
      throw new Error(
        `Invalid checksum "${originalInput}" — ${which} hash prefix must be 2 lowercase letters, got "${hashPrefix}"`,
      );
    }
    if (!DECIMAL_INT.test(lineStr)) {
      throw new Error(
        `Invalid checksum "${originalInput}" — ${which} line must be a decimal integer, got "${lineStr}"`,
      );
    }
    return { line: Number(lineStr), hashPrefix };
  }

  // Decimal format: "9"
  if (!DECIMAL_INT.test(ref)) {
    throw new Error(
      `Invalid checksum "${originalInput}" — ${which} line must be a decimal integer (expected format "aj.9-na.10:hex" or "9-10:hex")`,
    );
  }
  return { line: Number(ref) };
}

/**
 * @typedef {Object} ReadRange
 * @property {number} start
 * @property {number} end
 */

/**
 * Parse and validate the `ranges` input for hash-verified read.
 *
 * Accepts string ranges like "10-20", "10" (single line), or "10-" (to EOF).
 * Returns a sorted, non-overlapping array of ranges. Undefined or empty
 * input returns a single whole-file range.
 *
 * @param {string[] | undefined} ranges - Array of range strings.
 * @returns {ReadRange[]} Sorted, merged array of ranges.
 */
export function parseRanges(ranges) {
  if (!ranges || ranges.length === 0) {
    return [{ start: 1, end: Infinity }];
  }

  /** @type {ReadRange[]} */
  const parsed = ranges.map((r) => {
    const dashIdx = r.indexOf("-");

    let start;
    let end;

    if (dashIdx === -1) {
      // "10" — single line
      start = Number(r);
      end = start;
    } else if (dashIdx === 0) {
      // "-20" — from start to line 20
      start = 1;
      end = Number(r.slice(1));
    } else if (dashIdx === r.length - 1) {
      // "10-" — from line 10 to EOF
      start = Number(r.slice(0, -1));
      end = Infinity;
    } else {
      // "10-20" — explicit range
      start = Number(r.slice(0, dashIdx));
      end = Number(r.slice(dashIdx + 1));
    }

    if (!Number.isInteger(start) || start < 1) {
      throw new Error(`Invalid range "${r}": start must be a positive integer`);
    }
    if (end !== Infinity && (!Number.isInteger(end) || end < 1)) {
      throw new Error(`Invalid range "${r}": end must be a positive integer`);
    }
    if (start > end) {
      throw new Error(`Invalid range "${r}": start ${start} must be <= end ${end}`);
    }
    return { start, end };
  });

  parsed.sort((a, b) => a.start - b.start);

  // Merge overlapping or adjacent ranges
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const curr = parsed[i];
    if (prev.end === Infinity || curr.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, curr.end);
      parsed.splice(i, 1);
      i--;
    }
  }

  return parsed;
}

/**
 * @typedef {Object} FilePathWithRanges
 * @property {string} path
 * @property {string[] | undefined} rangeSpecs
 */

/**
 * Split a file_path entry into path and optional inline ranges.
 *
 * Accepted forms:
 *   "src/foo.ts"             → { path: "src/foo.ts", rangeSpecs: undefined }
 *   "src/foo.ts:10-25"       → { path: "src/foo.ts", rangeSpecs: ["10-25"] }
 *   "src/foo.ts:1-20,200-220" → { path: "src/foo.ts", rangeSpecs: ["1-20", "200-220"] }
 *   "src/foo.ts:10"          → { path: "src/foo.ts", rangeSpecs: ["10"] }
 *   "src/foo.ts:10-"         → { path: "src/foo.ts", rangeSpecs: ["10-"] }
 *
 * The split point is the last ':' followed by a digit. This avoids
 * ambiguity with Windows drive letters (C:\...) or other colons in paths.
 *
 * @param {string} entry - The file path entry possibly with inline ranges.
 * @returns {FilePathWithRanges}
 */
export function parseFilePathWithRanges(entry) {
  // Find the last ':' followed by a digit
  for (let i = entry.length - 1; i >= 0; i--) {
    if (entry[i] === ":" && i + 1 < entry.length && /\d/.test(entry[i + 1])) {
      const path = entry.slice(0, i);
      const rangeStr = entry.slice(i + 1);
      // Don't split if the path would be empty or a single letter (drive letter)
      if (path.length <= 1) continue;
      return {
        path,
        rangeSpecs: rangeStr.split(",").map((r) => r.trim()),
      };
    }
  }
  return { path: entry, rangeSpecs: undefined };
}
