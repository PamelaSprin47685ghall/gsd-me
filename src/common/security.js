// ==============================================================================
// gsd-trueline — Path validation, deny patterns, and security module
// ==============================================================================
// Ported from trueline-mcp's security.js and shared.ts validatePath logic.
// All functions are pure JavaScript ESM with no external dependencies.

import { realpath, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { glob } from "node:fs/promises";
import { execFile } from "node:child_process";
import { matchesGlob } from "node:path";

// ==============================================================================
// Module-level caches
// ==============================================================================

/** @type {Map<string, { mtime: number; globs: string[] | null }>} */
const settingsCache = new Map();

/** @type {Map<string, RegExp>} */
const regexCache = new Map();

/** @type {Map<string, string[] | null>} */
const gitFilesCache = new Map();

/**
 * Clear internal caches. Exported for testing only.
 */
export function clearCaches() {
  settingsCache.clear();
  regexCache.clear();
}

/**
 * Clear the git file list cache (for testing).
 */
export function clearGitFilesCache() {
  gitFilesCache.clear();
}

// ==============================================================================
// Pattern Parsing
// ==============================================================================

/**
 * Parse any tool permission pattern like "ToolName(glob)".
 * Returns { tool, glob } or null if not a valid pattern.
 * @param {string} pattern
 * @returns {{ tool: string; glob: string } | null}
 */
export function parseToolPattern(pattern) {
  // .+ is greedy: for "Read(some(path))" it captures "some(path)"
  // because $ forces the final \) to match only the last paren.
  const match = pattern.match(/^(\w+)\((.+)\)$/);
  return match ? { tool: match[1], glob: match[2] } : null;
}

// ==============================================================================
// Glob-to-Regex Conversion
// ==============================================================================

/**
 * Convert a file path glob to a regex.
 *
 * - `**` matches any number of path segments (including zero)
 * - `*` matches anything except path separators
 * - `?` matches a single non-separator character
 * - Paths are matched with forward slashes (callers normalize first)
 *
 * @param {string} glob
 * @param {boolean} [caseInsensitive=false]
 * @returns {RegExp}
 */
export function fileGlobToRegex(glob, caseInsensitive = false) {
  const cacheKey = `${glob}:${caseInsensitive}`;
  const cached = regexCache.get(cacheKey);
  if (cached) return cached;

  // Collapse consecutive globstars ("**/**/**/") into a single "**/" to
  // prevent exponential backtracking — each `**/` becomes `(.*/)?` in the
  // regex, and multiple adjacent groups cause catastrophic backtracking.
  glob = glob.replace(/(\*\*\/)+/g, "**/");

  // Tokenize the glob: match globstar+slash, globstar, single-star, question
  // mark, or a run of literal characters — then map each token to its regex.
  const regexStr = glob.replace(/\*\*\/|\*\*|\*|\?|[^*?]+/g, (token, offset) => {
    const atBoundary = offset === 0 || glob[offset - 1] === "/";
    switch (token) {
      case "**/":
        return atBoundary ? "(.*/)?" : "[^/]*/";
      case "**":
        return atBoundary ? ".*" : "[^/]*";
      case "*":
        return "[^/]*";
      case "?":
        return "[^/]";
      default:
        return token.replace(/[.+^${}()|[\]\\/-]/g, "\\$&");
    }
  });

  const re = new RegExp(`^${regexStr}$`, caseInsensitive ? "i" : "");
  regexCache.set(cacheKey, re);
  return re;
}

// ==============================================================================
// Settings Reader
// ==============================================================================

/**
 * Read deny patterns for a specific tool from the 3-tier settings files.
 *
 * Returns an array of arrays (one per settings file found, in precedence
 * order). Each inner array contains the extracted glob strings.
 *
 * Precedence order (most local first):
 *   1. .claude/settings.local.json  (project-local)
 *   2. .claude/settings.json        (project-shared)
 *   3. ~/.claude/settings.json      (global)
 *
 * @param {string} toolName
 * @param {string} [projectDir]
 * @param {string} [globalSettingsPath]
 * @returns {Promise<string[][]>}
 */
export async function readToolDenyPatterns(toolName, projectDir, globalSettingsPath) {
  /** @param {string} path @returns {Promise<string[] | null>} */
  const extractGlobs = async (path) => {
    const cacheKey = `${path}:${toolName}`;
    // Check mtime — if unchanged since last call, return cached result.
    /** @type {number} */
    let mtime;
    try {
      mtime = (await stat(path)).mtimeMs;
    } catch {
      return null;
    }

    const cached = settingsCache.get(cacheKey);
    if (cached && cached.mtime === mtime) return cached.globs;

    // Read and parse in one step — both failures mean "no usable data".
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path, "utf-8"));
    } catch {
      settingsCache.set(cacheKey, { mtime, globs: null });
      return null;
    }

    // Extract globs for the target tool from permissions.deny.
    const obj =
      typeof parsed === "object" && parsed !== null ? /** @type {Record<string, unknown>} */ (parsed) : undefined;
    const perms =
      typeof obj?.permissions === "object" && obj.permissions !== null
        ? /** @type {Record<string, unknown>} */ (obj.permissions)
        : undefined;
    const denyArr = perms?.deny;
    /** @type {string[]} */
    const globs = [];
    if (Array.isArray(denyArr)) {
      for (const entry of denyArr) {
        if (typeof entry !== "string") continue;
        const tp = parseToolPattern(entry);
        if (tp?.tool === toolName) globs.push(tp.glob);
      }
    }
    settingsCache.set(cacheKey, { mtime, globs });
    return globs;
  };

  /** @type {string[]} */
  const paths = [];
  if (projectDir) {
    paths.push(resolve(projectDir, ".claude", "settings.local.json"));
    paths.push(resolve(projectDir, ".claude", "settings.json"));
  }
  paths.push(globalSettingsPath ?? resolve(homedir(), ".claude", "settings.json"));

  // Read all settings files in parallel — they're independent.
  const allGlobs = await Promise.all(paths.map(extractGlobs));
  return allGlobs.filter((g) => g !== null);
}

// ==============================================================================
// File Path Evaluation
// ==============================================================================

/**
 * Check if a file path should be denied based on deny globs.
 *
 * Normalizes backslashes to forward slashes before matching so that
 * Windows paths work with Unix-style glob patterns.
 *
 * @param {string} filePath
 * @param {string[][]} denyGlobs
 * @param {boolean} [caseInsensitive]
 * @returns {{ denied: boolean; matchedPattern?: string }}
 */
export function evaluateFilePath(filePath, denyGlobs, caseInsensitive = process.platform === "win32") {
  const normalized = filePath.replace(/\\/g, "/");
  // For globs without path separators, also test just the basename so that
  // a simple pattern like ".env" matches "/any/path/.env" — the same
  // gitignore-style semantics Claude Code settings use.
  const basename = normalized.split("/").pop() ?? normalized;

  /** @param {string} glob @returns {boolean} */
  const matches = (glob) => {
    const re = fileGlobToRegex(glob, caseInsensitive);
    if (re.test(normalized)) return true;

    // Glob without "/" — also test the basename (gitignore semantics).
    if (!glob.includes("/")) return re.test(basename);

    // Relative glob with "/" — treat as a suffix match via globstar prefix.
    // e.g. deny pattern "src/.env" should match "/project/src/.env".
    if (!glob.startsWith("/") && !glob.startsWith("*")) {
      return fileGlobToRegex(`**/${glob}`, caseInsensitive).test(normalized);
    }

    return false;
  };

  const matchedPattern = denyGlobs.flat().find(matches);
  return matchedPattern ? { denied: true, matchedPattern } : { denied: false };
}

// ==============================================================================
// Path Validation
// ==============================================================================

/**
 * Validate and resolve a file path without reading its content.
 *
 * Performs symlink resolution, containment checks, deny-pattern evaluation,
 * and size enforcement.
 *
 * @param {string} file_path - The file path to validate
 * @param {string} toolName - Tool name for deny pattern lookup
 * @param {string} [projectDir] - Project root directory
 * @param {string[]} [allowedDirs=[]] - Additional allowed directories
 * @returns {Promise<{ok: boolean; resolvedPath?: string; size?: number; mtimeMs?: number; error?: {content: Array<{type: string; text: string}>; isError?: boolean}}>}
 */
export async function validatePath(file_path, toolName, projectDir, allowedDirs = []) {
  // Reject wildcard — only trueline_changes supports "*" via its own handler.
  if (file_path === "*") {
    return {
      ok: false,
      error: errorResult('Wildcard "*" is only supported by trueline_changes. Pass an explicit file path.'),
    };
  }

  const resolvedPath = file_path.startsWith("/") ? file_path : resolve(projectDir ?? process.cwd(), file_path);

  // Resolve symlinks and check containment to prevent path traversal.
  // realpath throws if the path doesn't exist — treat as file-not-found.
  let realPath;
  try {
    realPath = await realpath(resolvedPath);
  } catch {
    return {
      ok: false,
      error: errorResult(`Error reading file: "${file_path}" not found`),
    };
  }

  // Reject directories, symlinks to directories, and special files.
  const fileStat = await stat(realPath);
  if (!fileStat.isFile()) {
    return {
      ok: false,
      error: errorResult(`"${file_path}" is not a regular file`),
    };
  }

  // Build the list of allowed base directories.
  let realBase;
  try {
    realBase = await realpath(projectDir ? projectDir : process.cwd());
  } catch {
    return {
      ok: false,
      error: errorResult("Project directory not found or inaccessible"),
    };
  }

  // Resolve allowedDirs through realpath too.
  const resolvedAllowed = await Promise.all(
    allowedDirs.map(async (d) => {
      try {
        return await realpath(d);
      } catch {
        return d;
      }
    }),
  );

  const allBases = [realBase, ...resolvedAllowed];
  const isContained =
    process.platform === "win32"
      ? allBases.some((base) => {
          const rp = realPath.toLowerCase();
          const bp = base.toLowerCase();
          return rp === bp || rp.startsWith(bp + sep);
        })
      : allBases.some((base) => realPath === base || realPath.startsWith(base + sep));

  if (!isContained) {
    return {
      ok: false,
      error: errorResult(`Access denied: "${file_path}" is outside the project directory`),
    };
  }

  // Evaluate deny patterns against the real path.
  const denyGlobs = await readToolDenyPatterns(toolName, projectDir);
  const { denied, matchedPattern } = evaluateFilePath(realPath, denyGlobs);
  if (denied) {
    return {
      ok: false,
      error: errorResult(`Access denied: "${file_path}" matched deny pattern "${matchedPattern}"`),
    };
  }

  // Reject files over 10 MB.
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  if (fileStat.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      error: errorResult(
        `"${file_path}" exceeds the 10 MB size limit (${(fileStat.size / 1024 / 1024).toFixed(1)} MB)`,
      ),
    };
  }

  return {
    ok: true,
    resolvedPath: realPath,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
  };
}

// ==============================================================================
// Glob Expansion
// ==============================================================================

const GLOB_CHARS = /[*?{[]/;
const RECURSIVE_GLOB = /\*\*/;

// Directories excluded when git is unavailable and a recursive glob is used.
const FALLBACK_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "vendor",
  "target",
]);

/**
 * Expand glob patterns in a file_paths array.
 *
 * Entries without glob characters pass through unchanged. Recursive globs
 * (containing `**`) use `git ls-files` to respect .gitignore, falling back
 * to Node glob with common directory exclusions. Non-recursive globs use
 * Node glob directly.
 *
 * @param {string[]} filePaths
 * @param {string} [projectDir]
 * @returns {Promise<string[]>}
 */
export async function expandGlobs(filePaths, projectDir) {
  const baseDir = projectDir ?? process.cwd();
  const result = [];
  const seen = new Set();

  function add(rawPath) {
    const path = rawPath.replaceAll("\\", "/");
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }

  for (const entry of filePaths) {
    if (!GLOB_CHARS.test(entry)) {
      add(entry);
      continue;
    }

    if (RECURSIVE_GLOB.test(entry)) {
      // Recursive glob: use git ls-files to respect .gitignore
      const gitFiles = await gitListFiles(baseDir);
      if (gitFiles) {
        for (const f of gitFiles) {
          if (matchesGlob(f, entry)) add(f);
        }
      } else {
        // Fallback: Node glob with common exclusions
        for await (const match of glob(entry, {
          cwd: baseDir,
          exclude: (name) => FALLBACK_EXCLUDE_DIRS.has(name),
        })) {
          add(match);
        }
      }
    } else {
      // Non-recursive glob: Node glob is safe (won't descend into node_modules)
      for await (const match of glob(entry, { cwd: baseDir })) {
        add(match);
      }
    }
  }

  result.sort();
  return result;
}

// ==============================================================================
// Git ls-files helper
// ==============================================================================

async function gitListFiles(cwd) {
  const cached = gitFilesCache.get(cwd);
  if (cached !== undefined) return cached;

  try {
    const result = await new Promise((resolve, reject) => {
      execFile(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { cwd, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout.split("\0").filter(Boolean));
        },
      );
    });
    gitFilesCache.set(cwd, result);
    return result;
  } catch {
    gitFilesCache.set(cwd, null);
    return null;
  }
}

// ==============================================================================
// Display path helper
// ==============================================================================

/**
 * Convert a file path to a display-friendly form for tool output headers.
 * Strips the projectDir prefix when the path is under it.
 *
 * @param {string} filePath
 * @param {string} [projectDir]
 * @returns {string}
 */
export function displayPath(filePath, projectDir) {
  const normalized = filePath.replaceAll("\\", "/");
  const normalizedProjectDir = projectDir?.replaceAll("\\", "/");
  if (normalizedProjectDir && normalized.startsWith(`${normalizedProjectDir}/`)) {
    return normalized.slice(normalizedProjectDir.length + 1);
  }
  return normalized;
}

// ==============================================================================
// Error result helper
// ==============================================================================

/**
 * Create a standard error ToolResult object.
 * @param {string} message
 * @returns {{ content: Array<{type: string; text: string}>, isError: boolean }}
 */
export function errorResult(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
