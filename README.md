# gsd-me

**GSD minimalist extension suite** — 一个 `gsd install` 装上全部 9 个插件。

## Install

**For users:**

```bash
gsd install https://github.com/PamelaSprin47685ghall/gsd-me
```

首次启动时自动克隆并加载以下插件：

| 插件                    | 用途                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `gsd-advisor`           | 让模型在决策前咨询更强的 advisor 模型                                        |
| `gsd-agent-loop`        | 自动循环：goal 模式、定次 passes、管道 pipeline                              |
| `gsd-explicit-reactive` | 显式 DEPS.json DAG 任务引擎                                                  |
| `gsd-fff`               | FFF 驱动的文件搜索 + 编辑器 @ 补全                                           |
| `gsd-guardian`          | auto-mode 失败自动恢复 + 超时看门狗                                          |
| `gsd-magic-todo`        | 结构化待办 + 只增 backlog，带上下文折叠                                      |
| `gsd-syntax`            | 写文件后 tree-sitter 语法检查                                                |
| `gsd-system-prompt`     | 稳定 system prompt，注入 HINTS，剪裁 Codebase Map，适配部分 provider payload |
| `gsd-web-search`        | 通过 Ollama API 提供 web_search / web_fetch 工具                             |

> 无需 `npm install -g`，不下载 gsd-2 框架源码。`gsd install` 将 URL 添加到 `~/.gsd/agent/settings.json`，启动时自动克隆插件子模块。

**For developers:**

```bash
# Clone the repo (HTTPS works for everyone)
git clone https://github.com/PamelaSprin47685ghall/gsd-me.git
cd gsd-me

# Initialize submodules
git submodule update --init --recursive

# Sync all submodules to latest (auto-converts to SSH for push)
./sync.sh
```

Note: `.gitmodules` uses HTTPS for public access. `sync.sh` automatically converts your local submodule remotes to SSH for push access, without modifying `.gitmodules`.

## Development Setup

For contributors who need push access to submodules:

```bash
# Clone the repo
git clone https://github.com/PamelaSprin47685ghall/gsd-me.git
cd gsd-me

# Initialize submodules (uses HTTPS by default)
git submodule update --init --recursive

# Convert to SSH for push access (developers only)
./dev-setup.sh
```

The `dev-setup.sh` script converts submodule URLs from HTTPS to SSH in your local git config, allowing you to push changes. The `.gitmodules` file remains HTTPS for public users.

## Architecture

本仓库是 **meta-plugin**：一个合法的 pi extension（`package.json` + `index.js`），通过 git submodule 引用 9 个独立插件仓库。`index.js` 在首次加载时自动 `git submodule update --init` 并逐一加载每个插件。

- 每个插件独立开发、独立测试、独立版本号
- 插件之间通过 `pi` API 注册 hooks/tools，互不依赖
- 插件各自实现幂等注册，`gsd-me` 重复调用无副作用

## Test

```bash
node --test test/*.test.js
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
