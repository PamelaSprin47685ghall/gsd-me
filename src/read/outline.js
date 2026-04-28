// ==============================================================================
// gsd-trueline — Regex-level code outline engine with per-language configs
//
// Scans code files line-by-line via splitLines, detecting structural elements
// (functions, classes, interfaces, etc.) and collapsing skip groups (imports,
// package declarations, etc.) into compact summary entries.
// ==============================================================================

import { splitLines } from "./line-splitter.js";

// ==============================================================================
// Types (JSDoc)
// ==============================================================================

/**
 * @typedef {Object} OutlineEntry
 * @property {number} startLine - 1-based start line.
 * @property {number} endLine - 1-based end line (inclusive).
 * @property {number} depth - Nesting depth (0 for top-level).
 * @property {string} nodeType - Structural element type.
 * @property {string} text - Display text.
 */

/**
 * @typedef {Object} HeadingRule
 * @property {RegExp} regex
 * @property {string} type
 */

/**
 * @typedef {Object} SkipRule
 * @property {RegExp} regex
 * @property {string} label
 */

/**
 * @typedef {Object} LangConfig
 * @property {string} label
 * @property {HeadingRule[]} headings
 * @property {SkipRule[]} skip
 */

// ==============================================================================
// Language Configurations
// ==============================================================================

/** @type {LangConfig} */
const JS_CONFIG = {
  label: "JavaScript",
  headings: [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s*\*?\s+/, type: "function" },
    { regex: /^(?:export\s+)?class\s+/, type: "class" },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+/, type: "declaration" },
  ],
  skip: [
    { regex: /^import\s+/, label: "import" },
    { regex: /^\/\/\/\s*<reference\s+/, label: "reference" },
  ],
};

/** @type {LangConfig} */
const TS_CONFIG = {
  label: "TypeScript",
  headings: [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s*\*?\s+/, type: "function" },
    { regex: /^(?:export\s+)?class\s+/, type: "class" },
    { regex: /^(?:export\s+)?interface\s+/, type: "interface" },
    { regex: /^(?:export\s+)?type\s+/, type: "type" },
    { regex: /^(?:export\s+)?enum\s+/, type: "enum" },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+/, type: "declaration" },
  ],
  skip: [
    { regex: /^import\s+/, label: "import" },
  ],
};

/** @type {LangConfig} */
const PY_CONFIG = {
  label: "Python",
  headings: [
    { regex: /^@/, type: "decorator" },
    { regex: /^(?:async\s+)?def\s+/, type: "function" },
    { regex: /^class\s+/, type: "class" },
  ],
  skip: [
    { regex: /^import\s+/, label: "import" },
    { regex: /^from\s+\S+\s+import/, label: "import" },
  ],
};

/** @type {LangConfig} */
const GO_CONFIG = {
  label: "Go",
  headings: [
    { regex: /^func\s+/, type: "function" },
    { regex: /^type\s+/, type: "type" },
    { regex: /^(?:const|var)\s+/, type: "declaration" },
  ],
  skip: [
    { regex: /^package\s+/, label: "package" },
    { regex: /^import\s+/, label: "import" },
  ],
};

/** @type {LangConfig} */
const RS_CONFIG = {
  label: "Rust",
  headings: [
    { regex: /^(?:pub\s+)?(?:unsafe\s+)?fn\s+/, type: "function" },
    { regex: /^(?:pub\s+)?struct\s+/, type: "struct" },
    { regex: /^(?:pub\s+)?enum\s+/, type: "enum" },
    { regex: /^(?:pub\s+)?trait\s+/, type: "trait" },
    { regex: /^(?:pub\s+)?impl\s+/, type: "impl" },
    { regex: /^(?:pub\s+)?mod\s+/, type: "module" },
    { regex: /^(?:pub\s+)?type\s+/, type: "type" },
    { regex: /^(?:pub\s+)?(?:const|static)\s+/, type: "declaration" },
  ],
  skip: [
    { regex: /^use\s+/, label: "use" },
  ],
};

/** @type {LangConfig} */
const JAVA_CONFIG = {
  label: "Java",
  headings: [
    { regex: /^(?:\s*)(?:public|private|protected)\s+(?:static\s+)?(?:class|interface|enum|@interface)\s+/, type: "class" },
    { regex: /^(?:\s*)(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:\S+(?:\s*<[^>]+>)?\s+)?\w+\s*\(/, type: "method" },
    { regex: /^(?:\s*)\w+(?:\s*<[^>]+>)?(?:\s*\[\])?\s+\w+\s*\(/, type: "method" },
  ],
  skip: [
    { regex: /^package\s+/, label: "package" },
    { regex: /^import\s+/, label: "import" },
  ],
};

/** @type {LangConfig} */
const C_CONFIG = {
  label: "C",
  headings: [
    { regex: /^struct\s+/, type: "struct" },
    { regex: /^enum\s+/, type: "enum" },
    { regex: /^typedef\s+/, type: "typedef" },
    { regex: /^(?:static\s+|extern\s+|inline\s+)?(?:void|int|char|float|double|long|short|unsigned|signed|const|size_t|ssize_t|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|char\s*\*|void\s*\*|int\s*\*|FILE\s*\*|struct\s+\w+\s*\*|unsigned\s+int|unsigned\s+long|long\s+long)\s+\*?\s*[a-zA-Z_]\w*\s*\(/, type: "function" },
  ],
  skip: [
    { regex: /^#include\s+/, label: "include" },
    { regex: /^#pragma\s+/, label: "pragma" },
    { regex: /^#define\s+/, label: "define" },
  ],
};

/** @type {LangConfig} */
const CPP_CONFIG = {
  label: "C++",
  headings: [
    { regex: /^(?:class|struct)\s+/, type: "class" },
    { regex: /^enum\s+/, type: "enum" },
    { regex: /^namespace\s+/, type: "namespace" },
    { regex: /^typedef\s+/, type: "typedef" },
    { regex: /^template\s+/, type: "template" },
    { regex: /^(?:virtual\s+|static\s+|inline\s+|explicit\s+|friend\s+)?(?:void|int|char|float|double|long|short|unsigned|signed|const|bool|size_t|auto|std::\w+|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t)\s+\*?\s*[a-zA-Z_]\w*\s*\(/, type: "function" },
    { regex: /^~?(?!if|while|for|switch|catch|return|sizeof)\w+\s*\(/, type: "function" },
  ],
  skip: [
    { regex: /^#include\s+/, label: "include" },
    { regex: /^using\s+(?:namespace\s+)?/, label: "using" },
  ],
};

// ==============================================================================
// Extension → Config mapping (aliases share config object references)
// ==============================================================================

export const LANGUAGE_CONFIGS = {
  ".js": JS_CONFIG,
  ".mjs": JS_CONFIG,
  ".cjs": JS_CONFIG,
  ".ts": TS_CONFIG,
  ".tsx": TS_CONFIG,
  ".py": PY_CONFIG,
  ".go": GO_CONFIG,
  ".rs": RS_CONFIG,
  ".java": JAVA_CONFIG,
  ".c": C_CONFIG,
  ".h": C_CONFIG,
  ".cpp": CPP_CONFIG,
  ".hpp": CPP_CONFIG,
};

/**
 * Resolve language config for a file extension.
 * @param {string} ext - File extension including dot (e.g. ".js").
 * @returns {LangConfig | null}
 */
export function getConfig(ext) {
  return LANGUAGE_CONFIGS[ext] ?? null;
}

/**
 * Extract file extension from a path.
 * @param {string} filePath
 * @returns {string | null}
 */
export function getExtension(filePath) {
  const m = filePath.match(/\.[a-z0-9]+$/i);
  return m ? m[0].toLowerCase() : null;
}

// ==============================================================================
// Skip group label helpers
// ==============================================================================

/**
 * Produce a human-readable label for a skip group, handling singular vs plural.
 * @param {string} label
 * @param {number} count
 * @returns {string}
 */
function pluralize(label, count) {
  if (count === 1) return label;
  // Simple plural: add 's' except for specific irregulars
  if (label === "use") return "uses";
  return label + "s";
}

// ==============================================================================
// Core scanning algorithm (streaming via splitLines)
// ==============================================================================

/**
 * Extract code outline from an async iterable of RawLine objects.
 *
 * @param {AsyncIterable<{lineBytes: Buffer, lineNumber: number}>} lines
 * @param {LangConfig} config
 * @returns {Promise<{entries: OutlineEntry[], totalLines: number}>}
 */
export async function extractOutlineFromLines(lines, config) {
  /** @type {OutlineEntry[]} */
  const entries = [];

  /** @type {{ startLine: number, count: number, label: string } | null} */
  let skipGroup = null;

  /** @type {OutlineEntry | null} */
  let currentHeading = null;

  let totalLines = 0;

  const iter = lines[Symbol.asyncIterator]();
  let result = await iter.next();

  while (!result.done) {
    const { lineBytes, lineNumber } = result.value;
    totalLines = lineNumber;
    const lineStr = lineBytes.toString("utf-8");

    // Advance to the next line immediately — result becomes lookahead
    result = await iter.next();

    // ── 1. Check skip patterns ────────────────────────────────────────────
    /** @type {SkipRule | null} */
    let matchedSkip = null;
    for (const s of config.skip) {
      if (s.regex.test(lineStr)) {
        matchedSkip = s;
        break;
      }
    }

    if (matchedSkip) {
      if (skipGroup === null) {
        skipGroup = { startLine: lineNumber, count: 1, label: matchedSkip.label };
      } else {
        skipGroup.count++;
      }
      continue;
    }

    // ── 2. Flush pending skip group ───────────────────────────────────────
    if (skipGroup !== null) {
      entries.push({
        startLine: skipGroup.startLine,
        endLine: lineNumber - 1,
        depth: 0,
        nodeType: "skipGroup",
        text: `(${skipGroup.count} ${pluralize(skipGroup.label, skipGroup.count)})`,
      });
      skipGroup = null;
    }

    // ── 3. Check heading patterns (first match wins) ──────────────────────
    /** @type {HeadingRule | null} */
    let matchedHeading = null;
    for (const h of config.headings) {
      if (h.regex.test(lineStr)) {
        matchedHeading = h;
        break;
      }
    }

    if (matchedHeading) {
      // Close previous heading entry (its range ends before this line)
      if (currentHeading !== null) {
        currentHeading.endLine = lineNumber - 1;
        entries.push(currentHeading);
      }

      // Build display text from the matched line
      let text = lineStr.trimEnd();

      // Multi-line signature extension: if line ends with `(` and no `)`,
      // read subsequent lines until `)` or `{` found (max 10 lines).
      if (text.endsWith("(") && !text.includes(")")) {
        for (let i = 0; i < 10; i++) {
          if (result.done) break;
          totalLines = result.value.lineNumber;
          const extraLine = result.value.lineBytes.toString("utf-8").trimEnd();
          text += " " + extraLine;
          result = await iter.next();
          if (extraLine.includes(")") || extraLine.includes("{")) break;
        }
      }

      // Truncate very long lines
      if (text.length > 200) {
        text = text.slice(0, 200) + "…";
      }

      currentHeading = {
        startLine: lineNumber,
        endLine: lineNumber,
        depth: 0,
        nodeType: matchedHeading.type,
        text,
      };
    }
    // ── 4. Lines matching neither are consumed silently ───────────────────
  }

  // ── EOF: flush any remaining groups ─────────────────────────────────────
  if (skipGroup !== null) {
    entries.push({
      startLine: skipGroup.startLine,
      endLine: totalLines,
      depth: 0,
      nodeType: "skipGroup",
      text: `(${skipGroup.count} ${pluralize(skipGroup.label, skipGroup.count)})`,
    });
  }

  if (currentHeading !== null) {
    currentHeading.endLine = totalLines;
    entries.push(currentHeading);
  }

  // Sort by startLine to maintain stable output order
  entries.sort((a, b) => a.startLine - b.startLine);
  return { entries, totalLines };
}

// ==============================================================================
// File-based entry point
// ==============================================================================

/**
 * Extract code outline from a file path using splitLines streaming.
 *
 * @param {string} filePath
 * @returns {Promise<{entries: OutlineEntry[], totalLines: number}>}
 */
export async function extractCodeOutline(filePath) {
  const ext = getExtension(filePath);
  const config = getConfig(ext);
  if (!config) return { entries: [], totalLines: 0 };
  return extractOutlineFromLines(splitLines(filePath), config);
}

// ==============================================================================
// Formatting
// ==============================================================================

/**
 * Format outline entries into a compact readable string.
 *
 * @param {OutlineEntry[]} entries
 * @param {number} totalLines - Total source lines in the file.
 * @returns {string}
 */
export function formatOutline(entries, totalLines) {
  if (entries.length === 0) {
    return `(0 symbols, ${totalLines} source lines)`;
  }

  const lines = entries.map((e) => {
    const range = e.startLine === e.endLine ? `${e.startLine}` : `${e.startLine}-${e.endLine}`;
    return `${range}: ${e.text}`;
  });

  const headingCount = entries.filter((e) => e.nodeType !== "skipGroup").length;
  lines.push(`(${headingCount} symbols, ${totalLines} source lines)`);

  return lines.join("\n");
}
