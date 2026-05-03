# GSD Extension Suite Spec

Version: `5.1.0`.

This document defines the shared contract for the extension suite. `README.md` is the user entry point; this file is the maintainer-facing behavior and compatibility contract.

## Reader contract

After reading this spec, a maintainer should be able to change one extension without breaking the behavior of the full suite when every extension is enabled at the same time.

## Meta-plugin architecture

`gsd-me` is a **meta-plugin**: a valid pi extension (`package.json` with `pi.extensions`, plus an `index.js` entry) that references 5 plugin submodules. When installed via:

```bash
gsd install https://github.com/PamelaSprin47685ghall/gsd-me.git
```

pi adds the URL to `~/.gsd/agent/settings.json`. On first startup, `index.js` runs `git submodule update --init` for the 5 plugin submodules, then dynamically imports and activates each one. `gsd-2` (the pi framework source) is kept as a submodule for local development but is never auto-initialized — it is not needed at runtime.

### File layout

```
gsd-me/
├── index.js            # Meta-loader: init submodules → import all 5 plugins
├── package.json         # pi.extensions: ["./index.js"]
├── gsd-agent-loop/      # submodule
├── gsd-explicit-reactive/ # submodule
├── gsd-guardian/        # submodule
├── gsd-magic-todo/      # submodule
├── gsd-system-prompt/   # submodule
├── gsd-2/               # submodule (local dev only, not auto-initialized)
├── test/
│   ├── meta-loader.test.js
│   ├── plugin-compatibility.test.js
│   ├── metadata-consistency.test.js
│   └── self-injection.test.js
└── SPEC.md
```

### Guarantees

- `index.js` is idempotent: calling it twice does not double-register tools, commands, or hooks (each plugin has its own `WeakSet` guard).
- Submodule init fails silently (offline, no network) — individual plugin `import()` errors propagate clearly.
- `gsd-2` submodule is NOT listed in the init set, so it is never downloaded.

## Extensions

| Extension               | Contract                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `gsd-system-prompt`     | Stabilizes outbound prompt and provider payload projections without rewriting session history.             |
| `gsd-magic-todo`        | Maintains structured todo state and durable work backlog across context folding and session navigation.    |
| `gsd-agent-loop`        | Adds explicit loop state, loop commands, and a loop-control tool for multi-turn agent work.                |
| `gsd-guardian`          | Recovers selected auto-mode failures without treating routine sibling-extension notifications as failures. |
| `gsd-explicit-reactive` | Runs slice tasks through an explicit `DEPS.json` DAG instead of implicit dependency inference.             |

## Shared packaging contract

Every extension in the suite must follow the same packaging shape:

- package version and manifest version are identical,
- manifest tier is `community`,
- platform requirement is `>=2.29.0`,
- package type is native ES module,
- package export is the extension entry module,
- package `pi.extensions` points at the extension entry module,
- manifest `provides` declares the actual public tool, command, hook, and shortcut surface.

The suite intentionally avoids a shared runtime dependency. The shared surface is still small enough that a public helper package would add more install and version risk than it removes.

## Self-injection contract

Each extension must add its entry module to `GSD_BUNDLED_EXTENSION_PATHS` at import time.

Rules:

- Use the platform path delimiter.
- Normalize directory entries to the extension entry module.
- Do not append duplicates.
- Preserve unrelated entries.
- Do not throw if the environment variable is absent.

This keeps forked sessions, subagents, and background task agents on the same extension surface as the parent session.

## Registration contract

Extension registration must be safe when all extensions load together.

- Tool names must be globally unique.
- Command names must be globally unique.
- Shortcut registrations must not collide unless the behavior is intentionally shared.
- Long-lived listeners and tools must be idempotent where reload or repeated injection can occur.
- Hooks that return modified data must preserve unrelated fields on the event payload.
- Hooks that do not own an event must return nothing rather than replacing sibling changes.

## Context projection contract

Extensions may project prompt or context content, but they must not mutate durable session history as a side effect.

- `gsd-system-prompt` projects system prompt and provider payload content.
- `gsd-magic-todo` projects todo context and compaction input.
- `gsd-agent-loop` injects loop state into the system prompt.

When multiple hooks run on the same event, each hook must operate on the latest projected value it receives.

## Notification and recovery contract

`gsd-guardian` is the only extension that may convert failure signals into recovery behavior.

Guardian must ignore routine sibling-extension notifications, including:

- todo restoration notices,
- prompt pruning warnings,
- loop status messages,
- DAG progress logs.

Guardian may recover only explicit auto-mode, dispatch, validation, missing-tool, or task-execution failure signals.

## DAG execution contract

`gsd-explicit-reactive` owns explicit task-level DAG execution.

Rules:

- Dependencies are declared in `DEPS.json`.
- File IO is not used to infer dependencies.
- A task can run only after every declared upstream task is complete.
- Invalid, cyclic, deadlocked, or too-narrow graphs return to planning with diagnostic state.
- Background task agents inherit the active parent tool surface.
- Failed background tasks are rolled back so the normal GSD state machine can replan.
- Session shutdown aborts active DAG managers and status surfaces.

## Loop execution contract

`gsd-agent-loop` owns explicit multi-turn loop state.

Rules:

- Goal loops end only when the agent calls `loop_control` with `done`.
- Fixed-pass loops run the requested number of iterations.
- Pipeline loops advance through named stages in order.
- Fixed-pass and pipeline loops cannot end early.
- Loop state must be restorable after session switch, fork, tree navigation, or reload.

## Todo backlog contract

`gsd-magic-todo` owns structured todo state and the append-only completed-work backlog.

Rules:

- Reads return the current todo list and backlog.
- Writes replace the full todo list.
- Every write includes a completed-work report.
- Context folding preserves the first backlog anchor and recent todo operations.
- Compaction receives a projected view that preserves resumability.

## Prompt stability contract

`gsd-system-prompt` owns stable prompt projection.

Rules:

- Stable HINTS are injected.
- Generated Codebase Map content is pruned from the outbound system prompt.
- HINTS loading failures are warnings, not fatal errors.
- Provider payload adaptation is model-gated.
- Secret values are never emitted in warnings or diagnostics.

## Verification contract

Before release, run:

```bash
node --test test/*.test.js
```

Then run every extension test suite:

```bash
cd gsd-system-prompt && npm test
cd ../gsd-magic-todo && npm test
cd ../gsd-agent-loop && npm test
cd ../gsd-guardian && npm test
cd ../gsd-explicit-reactive && npm test
```

The full-suite compatibility test must prove that all extensions can load together, preserve their public surfaces, compose prompt/context projections, and avoid Guardian false recovery from sibling-extension warnings.
