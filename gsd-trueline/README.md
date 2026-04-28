# Research: gsd-trueline — 融合 trueline-mcp 与 gsd-multi-edit 的超集扩展

## 背景

根据用户需求，实现 `./gsd-trueline` 扩展，吸收以下两个项目的核心能力：

1. **trueline-mcp** (rjkaes/trueline-mcp v2.12.0) — 基于 FNV-1a 哈希校验的文件读写/编辑 MCP 协议
2. **gsd-multi-edit** (v1.7.2) — 增强 edit 工具，支持批量 multi、Codex patch、虚拟预检和原子回滚

同时需要废弃 `gsd-multi-edit`（其功能完全被吸收），并适配 `trueline_search` 为合适的 GSD 命名。

---

## 一、trueline-mcp 架构详解

### 1.1 核心思想

每个读出的行携带短哈希引用；每次编辑必须呈现服务器签发的 ref token，证明 LLM 正基于文件的真实内容工作而非幻觉。

### 1.2 6 个工具

| 工具 | 职责 |
|------|------|
| `trueline_outline` | AST 结构概览（~10-20 lines vs 全文数百行），基于 tree-sitter WASM、markdown、XML 流式状态机 |
| `trueline_read` | 流式读取，每行带 `hash.line\tcontent` 前缀，每个 range 尾附加 ref token |
| `trueline_search` | 按模式搜索，返回带 hash 和 ref 的行，可直接喂入 edit |
| `trueline_edit` | 哈希验证的编辑：必须提供从 read/search 输出的 ref 和 hash.line range |
| `trueline_verify` | 无状态 ref 验证器（重新计算 checksum），判断 ref 是否仍然有效 |
| `trueline_changes` | 语义化 diff：基于 tree-sitter AST 识别新增/删除/重命名/签名变更 |

### 1.3 哈希系统

```
per-line hash: FNV-1a 32-bit (单行内容) → hashToLetters() → 2 字母 tag (a-z, 676 组合)
range checksum: foldHash() 将每行完整 32-bit hash 逐字节叠入 → checksumToLetters() → 6 字母 (26^6 ≈ 3 亿)
ref 格式: ab.startLine-cd.endLine:efghij
空文件: 0-0:aaaaaa
```

三层保护：
- **Boundary hash** — 编辑开始/结束行的 2-letter tag，快速失败
- **Range checksum** — 整个读窗口的 FNV-1a 累加器，捕获窗口内任何行变更
- **mtime guard** — 原子 rename 前二次检查文件修改时间

### 1.4 流式编辑管线

```
validatePath (安全边界) → validateEdits (无 I/O 结构验证) → streamingEdit (单遍流式)
```

结构验证阶段：
1. `parseRange` — range 字符串格式是否合法
2. `line-0 check` — line 0 只允许 +0 (prepend)
3. `coverage check` — ref 的 range 覆盖 edit 的 range
4. `overlap check` — 无重叠编辑
5. insert_after 与 replace 冲突检测

流式应用阶段：
- 升序处理编辑（与内存倒序相反，因为流式无随机访问）
- 未变更行以 raw bytes 写出，零 string 分配
- 变更检测：字节级对比替换内容与原始行
- EOL 自动检测：首个行尾确定，未变更行保留原始字节
- 原子 rename：写入 tmp 文件 → mtime 校验 → rename

### 1.5 Outline 架构

三层：
1. **Parser management** — 延迟初始化 web-tree-sitter WASM，缓存加载的语言
2. **Language configs** — 20+ 语言的 AST 节点类型配置（outline/skip/recurse/topLevelOnly）
3. **Extraction** — AST 遍历 + markdown/XML 流式状态机（不加载全文）

输出格式：
```
1-10: (10 imports)
12-12: const VERSION = pkg.version;
25-45: async function resolveAllowedDirs(): Promise<string[]> {
  3-3: constructor(name: string) {
(8 symbols, 50 source lines)
```

### 1.6 Read 流式架构

通过 `splitLines` 以 64KB chunk 流式读取文件，永不全文加载。

- 支持 `file_paths: ["src/foo.ts:10-25", "src/bar.ts"]` 这种内联 range 语法
- 每个 range 出独立的 ref，互不干扰
- 多文件视为批量，每个文件独立处理
- 空文件返回 `0-0:aaaaaa` sentinel ref
- 超 2000 行截断 + 提示使用 range

### 1.7 安全模型

- 三层 deny patterns：`.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json`
- 路径包含检查（symlink 解析后必须在项目目录内）
- 二进制文件 null byte 检测
- 10MB 大小限制
- 仅允许 regular file

---

## 二、gsd-multi-edit 架构详解

### 2.1 核心能力

| 特性 | 实现 |
|------|------|
| `multi` 参数 | 一次调用传多条 `(path, oldText, newText)`，按文件分组、同文件按位置排序 |
| `patch` 参数 | 解析 `*** Begin/End Patch` + Add/Delete/Update File + `@@` hunks |
| 虚拟预检 | 在内存虚拟文件系统中先验证所有编辑，全部通过才写真实文件 |
| 原子回滚 | 按文件记录快照，失败时自动恢复已写入的文件 |
| 模糊匹配 fallback | 精确 → 花引号归一 → 行尾空格容忍 |
| 文件级锁 | 并发安全：每个文件写入时获取独占锁 |
| 上下文通知 | 真实写操作后通过 pi.events.emit('context-guard:file-modified') 通知系统 |

### 2.2 模块结构

```
index.js          ← 插件入口，注册增强 edit 工具
src/
  classic.js      ← 经典 edit 引擎（单条/批量模式）
  patch.js        ← Codex 风格补丁引擎
  patch-parse.js  ← 补丁解析器（LineCursor + parsePatch / parseHunk）
  patch-apply.js  ← 补丁应用器（findBlock + applyHunks — 支持行尾空格容错）
  diff.js         ← 双通 diff 渲染器（基于 diff 库）
  match.js        ← 三层文本匹配（精确 → 花引号 → 行尾空格容忍）
  apply.js        ← 每文件编辑组应用逻辑（applyGroupToContent、formatResults）
  workspace.js    ← 工作区抽象（真实 fs + 虚拟内存预检模式）
  schema.js       ← TypeBox schema 定义
```

### 2.3 并发安全机制

- 文件级锁：`acquireLock()` 为每个文件路径维护 Promise 链
- 确定性排序：多文件操作按路径字典序排序，避免死锁
- 读缓存隔离：每个 `createRealWorkspace()` 调用创建独立 `readCache`

### 2.4 命名技巧

manifest ID 为 `"edit-plus"` （`e` < `g`，ASCII 排序在 `gsd-*` 之前），确保在 GSD 内置工具前注册并覆盖。

---

## 三、gsd-trueline 设计方案

### 3.1 工具集

| 工具名 | 来源 | 行为 |
|--------|------|------|
| `read` | trueline_outline + trueline_read | **默认：outline。有 offset/limit/ranges 时：hash-verified 流式读取**。每行输出 `hash.line\tcontent` + ref |
| `edit` | trueline_edit + gsd-multi-edit | **纯 hash-verified 模式**。吸收 gsd-multi-edit 的 multi/预检/并行安全能力 + 内化 trueline_verify |
| `search` | trueline_search | 搜索 + hash 前缀 + ref，可直接接入 edit |
| (融于 `edit`) | trueline_verify | 验证功能不单独为工具，融入 `edit` 的编辑校验流程中 |

### 3.2 `read` 工具智能分派

```
输入 offset/limit/ranges?
  ├─ 是 → 调用 hash-verified 流式读取（trueline_read 模式）
  │       输出: {
  │         "hash.line\tcontent",  // 每行格式
  │         "ref: ab.start-cd.end:efghij"
  │       }
  └─ 否 → 调用 outline（trueline_outline 模式）
          输出: {
             "1-10: (10 imports)",
             "25-45: async function foo() {",
             "(8 symbols, 50 source lines)"
           }
```

### 3.3 `edit` 工具单模式架构

纯 hash-verified 模式，但吸收 gsd-multi-edit 的生产力特性：

**核心（源自 trueline_edit）**：
- `edits: [{ ref, range, content, action }]` — 基于 ref 和 hash.line range
- 流式单遍应用 + 边界 hash 验证 + range checksum 验证 + mtime guard
- 不支持 oldText 匹配（hash 就是验证）

**增强（源自 gsd-multi-edit）**：
- `multi` 参数 — 一次调用传递多条编辑，按文件分组、同文件按位置排序
- `patch` 参数 — Codex 风格补丁（`*** Begin/End Patch` + `@@` hunks）
- 虚拟预检（virtual workspace）— 先验证所有编辑再写真实文件
- 原子回滚 — 按文件记录快照，失败自动恢复
- 文件级锁 — 并发安全，每个文件独占锁
- 确定性排序 — 多文件按路径字典序，避免死锁
- 分离的读缓存 — 每个 workspace 创建独立 readCache

**验证能力（源自 trueline_verify，内化）**：
- 无需单独 `gsd_verify` 工具
- `edit` 每次编辑内部先验证 ref 有效性（重新计算 checksum），失败即返回错误而非静默写入

### 3.4 抢先注册命名

以 `trueline` 工具集为核心，但为了让 `read`/`edit` 工具在 GSD 内置前注册，manifest ID 需要 ASCII 排序在 `gsd` 之前。

```
manifest.id: "edit-pp"  → 新命名，pp = preflight + parallel
```

`edit-pp` 的 ASCII 排序：`e-d-i-t---p-p` < `g-s-d-*`，确保抢先注册。

内部工具注册名：
- `read` — 覆盖 GSD 内置 read
- `edit` — 覆盖 GSD 内置 edit（纯 hash-verified 模式）
- `search` — trueline_search 适配
- `outline` — 单独导出以兼容需要直接调用 outline 的场景（可选）

### 3.5 SKILL 指令拆解到工具说明

将 `skills/trueline-workflow/SKILL.md` 的工作流知识直接嵌入各工具的 `description` 和 `promptGuidelines` 中：

**read (outline+read 混合)**：
```
description: "Read files from disk... By DEFAULT (no range specified), 
outputs a structural outline (functions/classes/types) — ~5-20 lines 
vs hundreds from a full read. When offset/limit or ranges are provided, 
reads exact lines with per-line FNV-1a hashes and a ref token for 
verified editing..."
promptGuidelines: [
  "Use read without offset/limit/ranges to understand file structure",
  "Use read with offset/limit or ranges to get hash-verified content for editing",
  "Copy ref tokens verbatim from output into edit's ref parameter",
  "Never fabricate hash prefixes — copy them from read output",
]
```

**edit**：
```
description: "Hash-verified file editing with preflight validation and 
parallel safety. Single-mode: all edits require ref+range tokens from 
read/search output (hash is the verification). Absorbs multi-edit's 
batch editing, Codex-patch, virtual workspace preflight, atomic 
rollback, and file-level concurrency locks. Ref verification is 
automatic — every edit internally validates ref validity before 
applying. Never fabricate refs — copy them from read/search output."
promptGuidelines: [
  "Use edit for precise changes (ref+range+content — hash-verified mode)",
  "Copy ref verbatim from read/search output — never fabricate refs",
  "Use the multi parameter to apply multiple edits in a single tool call (batched + preflighted)",
  "Use the patch parameter for Codex-style multi-file / hunk-based edits",
  "Use action='insert_after' to add lines without replacing existing ones",
  "Action line 0 (+0) is valid only for prepend (insert at start)",
  "Edits are streamed in ascending line order — no random-access assumption",
  "Virtual workspace preflight validates all edits before any file write",
  "Automatic rollback on failure — no partial writes",
]
```

**search**：
```
description: "Search files for a literal string or regex pattern. 
Returns matching lines with per-line hashes and refs — ready for 
immediate hash-verified editing. Supports multiple files in one call."
promptGuidelines: [
  "Use search when you know what to search for — it returns hash-line refs directly",
  "Pass the ref from search output into edit for fast verified editing",
  "Use search without read step for surgical edits",
]
```

### 3.6 模块结构

```
gsd-trueline/
  extension-manifest.json     ← id: "edit-pp" (排序在 gsd 前)
  package.json                ← pi extension
  index.js                    ← 插件入口，注册所有工具

  src/
    read/                     ← read 工具：outline + hash-verified read
      index.js                ← 智能分派器
      outline.js              ← tree-sitter outline 引擎
      outline-markdown.js     ← markdown 流式 outline
      outline-xml.js          ← XML 流式 outline
      outline-languages.js    ← 20+ 语言配置
      reader.js               ← 流式 hash-verified 读取器
      line-splitter.js        ← 64KB chunk 行分割器

    edit/                     ← edit 工具：纯 hash-verified + multi/预检
      index.js                ← 编辑分派器（hash-verified 单模式）
      streaming-edit.js       ← trueline_edit 流式编辑引擎
      multi-edit.js           ← gsd-multi-edit 批量/并发/预检集成
      patch.js                ← Codex 补丁引擎
      workspace.js            ← 工作区抽象（真实 fs + 虚拟内存预检模式）
      verify.js               ← ref/checksum 验证（内化 trueline_verify）
      diff.js                 ← diff 渲染器（预检失败时输出差异）

    search/                   ← search 搜索工具
      index.js                ← 搜索分派器
      search-line.js          ← 逐行搜索引擎
      search-multiline.js     ← 多行搜索引擎

    common/                   ← 共享模块
      hash.js                 ← FNV-1a 哈希（供 read/edit/search 共用）
      parse.js                ← range/ref/checksum 解析
      security.js             ← 路径验证、deny patterns
```

**核心原则**：所有模块保持纯函数 + 显式状态。避免 Class 和 TypeScript 编译链。

### 3.7 依赖树

```
index.js
  ├── src/read/index.js
  │     ├── src/common/hash.js
  │     ├── src/common/parse.js
  │     ├── src/common/security.js
  │     ├── src/read/outline.js
  │     │     └── src/read/outline-languages.js
  │     ├── src/read/outline-markdown.js
  │     ├── src/read/outline-xml.js
  │     └── src/read/reader.js
  │           ├── src/read/line-splitter.js
  │           └── src/common/hash.js
  │
  ├── src/edit/index.js
  │     ├── src/edit/streaming-edit.js (trueline_edit 流式核心)
  │     │     ├── src/common/hash.js
  │     │     ├── src/common/parse.js
  │     │     ├── src/edit/verify.js
  │     │     └── src/read/line-splitter.js
  │     ├── src/edit/multi-edit.js (gsd-multi-edit 批量/并发/预检)
  │     │     ├── src/edit/workspace.js
  │     │     ├── src/edit/diff.js (diff 库)
  │     │     └── src/edit/streaming-edit.js
  │     ├── src/edit/patch.js (Codex 补丁引擎)
  │     │     ├── src/edit/workspace.js
  │     │     └── src/edit/streaming-edit.js
  │     └── src/edit/verify.js (内化 trueline_verify)
  │
  └── src/search/index.js
        ├── src/common/hash.js
        ├── src/common/parse.js
        ├── src/common/security.js
        ├── src/search/search-line.js
        └── src/search/search-multiline.js
```

### 3.8 依赖

对比两个项目的依赖：

| 依赖 | trueline-mcp | gsd-multi-edit | gsd-trueline 方案 |
|------|-------------|----------------|-------------------|
| tree-sitter-wasms | ✅ (outline) | — | ✅ 保留（outline 核心） |
| web-tree-sitter | ✅ | — | ✅ 保留 |
| diff | — | ✅ (diff 渲染) | ✅ 保留 |
| @sinclair/typebox | — | ✅ (schema) | ❌ 去掉（手写 JSON schema，更轻量） |
| zod | ✅ (验证) | — | ❌ 去掉（内部 validation 手写） |

**原则**：保持极简零构建。手写 JSON schema（如 trueline-mcp 的 `readJsonSchema`、`editJsonSchema`）。保留 diff 库（gsd-multi-edit 已用，diff 渲染必需）。

### 3.9 与 pi 的事件集成

gsd-multi-edit 做的：
- `pi.on("tool_call", handler)` — 修补 event.input.path 避免 crash
- `pi.events.emit("context-guard:file-modified", ...)` — 通知上下文系统

gsd-trueline 需要同样做，并新增：
- `pi.on("tool_call", handler)` — 修补 read 和 edit 的默认行为
- 对于 read 工具：在 tool_call 事件中检测是否有 offset/limit/ranges，决定分派到 outline 还是 hash-read

注意：`context-guard:file-modified` 事件路径需要测试确认是否还存在。

---

## 四、关键决断

### 4.1 工具命名

| trueline-mcp | gsd-trueline | 理由 |
|-------------|--------------|------|
| `trueline_read` | `read` (覆盖内置) | 用户要求替换 read 默认行为 |
| `trueline_edit` | `edit` (覆盖内置) | 吸收 gsd-multi-edit + trueline_edit |
| `trueline_outline` | 内联到 `read` 默认模式 | 用户要求：无 range → outline |
| `trueline_search` | `search` | 简名直配
| `trueline_verify` | 融于 `edit` | 编辑内化验证，无需独立工具 |

### 4.2 `read` 工具的智能分派参数

为了不破坏 GSD 内置 `read` 的兼容性，保留 `path` 作为文件路径，新增行为通过已有参数触发：

```
read(path)                    → outline   (默认)
read(path, offset, limit)     → hash-read (GSD 内置语法)
read(path, ranges=["10-25"])  → hash-read (trueline 语法)
read(file_paths=[...])        → multi-hash-read 或 multi-outline
```

GSD 内置 read 的参数是 `(path, offset, limit)` — 这正好作为分派条件。

### 4.3 源码组织

采用与 `gsd-context-prune` 相同的极简单文件插件风格：
- 入口 `index.js`：工具注册 + 事件绑定
- `src/` 子模块：按工具分组，保持纯函数
- 无构建步骤，无 TypeScript

---

## 五、实施优先级

1. **哈希系统层** (`src/common/hash.js`, `src/common/parse.js`) — 基础
2. **line-splitter** (`src/read/line-splitter.js`) — 流式读取基础
3. **security** (`src/common/security.js`) — 路径验证
4. **read 工具** — outline 模式先实现（基于正则/简单提取，不依赖 tree-sitter），然后 hash-read 模式
5. **edit 工具** — 纯 hash-verified 模式 + 吸收 gsd-multi-edit 的 multi/预检/并行安全 + 内化 verify
6. **search** — trueline_search 适配
7. **tree-sitter outline** — 深度 outline（20+ 语言 AST 支持）
8. **测试**
9. **废弃 gsd-multi-edit** — 在 README 和 install.sh 中标记

---

## 六、风险与权衡

| 风险 | 缓解 |
|------|------|
| tree-sitter WASM 载入复杂（40+ MB wasm 文件） | 延迟加载 + 缓存；先实现 markdown/regex 基础 outline |
| hash-verified edit 增加复杂度（双模式 edit） | 清晰互斥规则。默认路径仍是 classic 模式 |
| 测试覆盖需保证三个来源的稳定性 | 优先 gsd-multi-edit 现有 25 个测试全部移植 |
| diff 库体积（~80KB minified） | 已评估：可接受，gsd-multi-edit 已在使用 |
| tree-sitter-wasms 包版本锁定风险 | 锁定 `0.1.13`，与 trueline-mcp 一致 |

---

## 七、glossary

| 术语 | 定义 |
|------|------|
| **ref** | 内联验证字符串，格式 `ab.start-cd.end:efghij`，由 read/search 签发，edit 必须提供 |
| **hash.line** | 每行 hash 前缀，2字母+行号，如 `ab.12` |
| **checksum** | 6 字母 base-26 编码的 FNV-1a 累加器，覆盖一个 range 的所有行 |
| **FNV-1a** | 32-bit 非加密哈希算法，用于行级别和 range 级别的快速校验 |
| **virtual workspace** | 内存文件系统，用于编辑前预检验证 |
| **phantom projection** | 非破坏性数据投影，不影响原始存储 |
| **sidecar** | 伴车策略：辅助进程/上下文在不阻塞主流程的情况下提供能力 |
