# GSD Extension Suite

A community extension suite for GSD / pi. The extensions can be installed individually, but they are designed to work together.

Current suite version: `5.1.0`.

## What is included

| Extension | Purpose |
|---|---|
| `gsd-system-prompt` | Stabilizes the system prompt, injects HINTS, prunes generated Codebase Map content, and adapts selected provider payloads. |
| `gsd-magic-todo` | Adds structured todo state plus an append-only work backlog for long sessions. |
| `gsd-agent-loop` | Adds explicit goal loops, fixed-pass loops, and staged pipelines. |
| `gsd-guardian` | Recovers selected auto-mode failures without discarding current session context. |
| `gsd-explicit-reactive` | Replaces inferred task parallelism with an explicit `DEPS.json` DAG. |

## Install the full suite

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/PamelaSprin47685ghall/gsd-me/main/install.sh)
```

Uninstall:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/PamelaSprin47685ghall/gsd-me/main/remove.sh)
```

Install one extension:

```bash
gsd install https://github.com/PamelaSprin47685ghall/gsd-system-prompt
```

## Which extensions should I use?

| Need | Install |
|---|---|
| More stable prompts and provider payloads | `gsd-system-prompt` |
| Durable todo state across long sessions | `gsd-magic-todo` |
| Agent loops that continue across turns | `gsd-agent-loop` |
| Recovery from recoverable auto-mode failures | `gsd-guardian` |
| Explicit task DAG execution | `gsd-explicit-reactive` |
| The full auto-mode enhancement stack | all extensions |

## How the suite fits together

The suite uses a small-contract architecture:

- no shared runtime package,
- native ES modules,
- consistent extension manifests,
- self-injected extension entry paths for forked sessions and background agents,
- unique tools, commands, and shortcuts,
- conservative failure recovery so routine sibling-extension warnings do not trigger repair loops.

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for the full behavior, compatibility, registration, and verification contract.

## Test

```bash
node --test test/*.test.mjs
```

Run individual extension suites before release:

```bash
cd gsd-system-prompt && npm test
cd ../gsd-magic-todo && npm test
cd ../gsd-agent-loop && npm test
cd ../gsd-guardian && npm test
cd ../gsd-explicit-reactive && npm test
```

## License

MIT
