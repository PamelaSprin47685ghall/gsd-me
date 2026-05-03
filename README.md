# gsd-me

**GSD minimalist extension suite** — 一个 `gsd install` 装上全部 5 个插件。

## Install

```bash
gsd install https://github.com/PamelaSprin47685ghall/gsd-me.git
```

首次启动时自动克隆并加载以下插件：

| 插件 | 用途 |
|---|---|
| `gsd-system-prompt` | 稳定 system prompt，注入 HINTS，剪裁 Codebase Map，适配部分 provider payload |
| `gsd-magic-todo` | 结构化待办 + 只增 backlog，带上下文折叠 |
| `gsd-agent-loop` | 自动循环：goal 模式、定次 passes、管道 pipeline |
| `gsd-guardian` | auto-mode 失败自动恢复 + 超时看门狗 |
| `gsd-explicit-reactive` | 显式 DEPS.json DAG 任务引擎 |

> 无需 `npm install -g`，不下载 gsd-2 框架源码。`gsd install` 将 URL 添加到 `~/.gsd/agent/settings.json`，启动时自动克隆插件子模块。

## Architecture

本仓库是 **meta-plugin**：一个合法的 pi extension（`package.json` + `index.js`），通过 git submodule 引用 5 个独立插件仓库。`index.js` 在首次加载时自动 `git submodule update --init` 并逐一加载每个插件。

- 每个插件独立开发、独立测试、独立版本号
- 插件之间通过 `pi` API 注册 hooks/tools，互不依赖
- 插件各自实现幂等注册，`gsd-me` 重复调用无副作用

## Test

```bash
node --test test/*.test.mjs
```

各插件独立测试：

```bash
cd gsd-system-prompt && npm test
cd ../gsd-magic-todo && npm test
cd ../gsd-agent-loop && npm test
cd ../gsd-guardian && npm test
cd ../gsd-explicit-reactive && npm test
```

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for the full behavior, compatibility, registration, and verification contract.

## License

MIT
