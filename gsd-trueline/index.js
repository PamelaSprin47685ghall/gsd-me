// ==============================================================================
// gsd-trueline — Extension entry point
//
// Registers a "read" tool that replaces pi's built-in read with hash-verified
// file reading. The extension id "edit-pp" ASCII-sorts before "gsd-*", ensuring
// our tool registration takes priority.
//
// The tool_call handler sanitizes event.input.path to prevent GSD's built-in
// read handler from crashing when our extension intercepts calls using the
// extended parameter set (file_paths, ranges, etc.).
// ==============================================================================

import { handleRead, handleReadMulti } from "./src/read/reader.js";
import { handleOutline, handleOutlineMulti } from "./src/read/index.js";
import { errorResult } from "./src/common/security.js";

/**
 * JSON Schema for the `read` tool parameters.
 *
 * Supports both the standard GSD-compatible interface (path + offset/limit)
 * and the extended trueline interface (ranges, file_paths with inline ranges).
 */
const readParamsSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "File path to read (relative to project root or absolute). Required for single-file reads. Not needed when file_paths is used.",
    },
    offset: {
      type: "number",
      description:
        "1-indexed starting line number. Convenience for GSD-compatible offset reads — converted to a range internally.",
    },
    limit: {
      type: "number",
      description:
        "Maximum number of lines to read. Used with offset for GSD-compatible reads. When omitted with offset, reads a single line.",
    },
    ranges: {
      type: "array",
      items: { type: "string" },
      description:
        'Trueline-style range syntax. Each entry may be: "10-20" (explicit range), "10" (single line), "10-" (to EOF), "-20" (from start). Ranges are expanded by 1 line on each side for boundary context.',
    },
    file_paths: {
      type: "array",
      items: { type: "string" },
      description:
        'Array of file paths for multi-file reads. Supports glob expansion and inline range syntax: "src/foo.ts:10-25". When set alone (without path), reads multiple files with section headers.',
    },
    encoding: {
      type: "string",
      description: "File encoding (defaults to utf-8). Accepted for GSD compatibility.",
    },
  },
  oneOf: [
    { required: ["path"] },
    { required: ["file_paths"] },
  ],
};

/**
 * Default export: extension initializer.
 *
 * @param {import("pi").PiApi} pi - The pi extension API object.
 */
export default function (pi) {
  // ────────────────────────────────────────────────────────────────────────────
  // Tool call signal handler
  //
  // GSD's built-in tool_call handler unconditionally accesses event.input.path
  // for "read" calls. When our tool receives calls using the extended parameters
  // (file_paths in place of path, or path omitted), event.input.path may be
  // undefined, which causes a crash in the built-in handler.
  //
  // This handler runs before the built-in handler (edit-pp < gsd-*) and
  // sanitizes the field to prevent the crash.
  // ────────────────────────────────────────────────────────────────────────────
  pi.on("tool_call", (event) => {
    if (event.toolName === "read" && typeof event.input.path !== "string") {
      event.input.path = "";
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Tool registration
  // ────────────────────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "read",
    label: "read",
    description:
      "Read files from disk with hash-verified lines and range refs. " +
      "By default (no offset/limit/ranges), reads the full file with hash-prefixed lines. " +
      "When offset/limit or ranges are provided, reads exact lines with per-line FNV-1a hashes " +
      "and a ref token for verification. Binary files, symlinks, and paths outside the project " +
      "are rejected. Multi-file reads via file_paths support glob expansion and inline " +
      'range syntax (e.g. "src/foo.ts:10-25").',
    promptGuidelines: [
      "Use read without offset/limit/ranges to read file content with hash-prefixed lines",
      "Use read with offset/limit or ranges to get hash-verified content",
      "Copy ref tokens verbatim from read output when constructing edit ranges",
      "Never fabricate hash prefixes — copy them from read output",
      "Use file_paths with inline ranges to read specific sections from multiple files",
    ],
    parameters: readParamsSchema,

    /**
     * Execute the read tool.
     *
     * Delegates to handleRead for single-file reads and handleReadMulti for
     * multi-file reads. Converts GSD-compatible offset/limit to ranges internally.
     *
     * @param {string} toolCallId
     * @param {object} params
     * @param {AbortSignal} signal
     * @param {Function} onUpdate
     * @param {{ cwd: string }} ctx
     * @returns {Promise<{ content: Array<{type: string, text: string}>, isError?: boolean }>}
     */
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { path, offset, limit, ranges, file_paths, encoding } = params;

      // ── Outline mode: when no offset/limit/ranges are specified, produce structural outline ──
      const isOutlineMode = offset === undefined && limit === undefined && (!ranges || ranges.length === 0);

      if (isOutlineMode) {
        if (file_paths && file_paths.length > 0) {
          const outlineResult = await handleOutlineMulti({
            file_paths,
            projectDir: ctx.cwd,
          });
          if (outlineResult !== null) return outlineResult;
          // Fall through to handleReadMulti for unsupported extensions
        } else if (path) {
          const outlineResult = await handleOutline({
            file_path: path,
            projectDir: ctx.cwd,
          });
          if (outlineResult !== null) return outlineResult;
          // Fall through to hash-verified read for unsupported extensions
        }
      }

      // ── Multi-file mode ──
      if (file_paths && file_paths.length > 0) {
        // Convert offset/limit to ranges for multi-file too, but only when
        // neither file_paths inline ranges nor explicit ranges are set.
        let effectiveRanges = ranges;
        if (!ranges && offset !== undefined) {
          effectiveRanges = limit !== undefined ? [`${offset}-${offset + limit - 1}`] : [`${offset}`];
        }

        return handleReadMulti({
          file_paths,
          ranges: effectiveRanges,
          encoding,
          projectDir: ctx.cwd,
        });
      }

      // ── Single-file mode ──
      if (!path) {
        return errorResult("path is required for single-file reads. Provide a file path or use file_paths for multi-file reads.");
      }

      // Convert offset/limit to ranges for GSD compatibility
      let effectiveRanges = ranges;
      if (offset !== undefined) {
        if (limit !== undefined) {
          effectiveRanges = [`${offset}-${offset + limit - 1}`];
        } else {
          effectiveRanges = [`${offset}`];
        }
      }

      return handleRead({
        file_path: path,
        ranges: effectiveRanges,
        encoding,
        projectDir: ctx.cwd,
      });
    },
  });
}
