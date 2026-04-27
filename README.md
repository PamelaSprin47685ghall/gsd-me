# GSD 极简扩展套件 (The Minimalist Extension Suite)

欢迎来到 GSD 极简扩展套件。本套件诞生于对早期复杂、臃肿、充满各类内部 API 劫持的 TypeScript 项目的反思。

我们抛弃了繁重的 Class、状态机、TypeScript 编译链，以及复杂的命令行工具与无用的树状视图。取而代之的是纯粹、内聚、**不到 300 行原生 JavaScript** 组成的超级单文件插件（Single-File Plugins）。

它们仅依赖 GSD 官方开放的事件生命周期和 Hook API，将极其硬核的控制力注入到 Auto-Mode 的血脉之中，且即使核心代码大版本更新，也能保持强悍的免疫力。

## 📦 包含插件 (The Plugins)

### 1. `gsd-auto-continue` (自动断点恢复)
**"不要阻塞，自动愈合。"** 
拦截所有意外的上下文溢出 (`context_overflow`)、验证失败及逻辑阻塞。利用伴车策略与指数退避模型自动分析并修复中断，满血复活 `auto-mode`。内置了精妙的工具死循环防护（Tool Call Loop Guards）与大模型 JSON 报错反序列化补丁。

### 2. `gsd-hints-injector` (稳定提示词注入)
**"剥离动态，锁定缓存。"**
静默地向主大模型挂载全局与项目级的 `HINTS.md` 提示词。最强杀招是将易变的动态内容（日期、路径）剥离出 System Prompt，并稳定化 API Payload 的 Hash 键值，将 LLM 提供商侧的 Prompt Cache 命中率拉到极限。

### 3. `gsd-context-prune` (双层上下文修剪)
**"伴车压缩，幻影投影。"**
采用非破坏性投影技术（Non-Destructive Projection），底层的核心历史永远是真实、仅追加的（Append-Only）。
- **初级精简**：伴随大模型将大量冗余的工具输出结果折叠为结构保留的单条摘要。
- **高级精简**：当上下文达到危险满载状态（>66.6%）时，强制“世界线坍缩”，用全局背景与进度直接替换历史。主模型永不阻塞。

### 4. `gsd-explicit-reactive` (显式并行波次调度)
**"化盲猜为静态配置。"**
彻底砸碎了原生核心中那不可控的“隐式读写图”并发推导算法。强制大模型通过静态的 `WAVES.json` 去显式声明并行波次，同时在底层加入了不可逾越的最大并发阈值流控。发生配置错误时，严苛的“报错即停”防线将大声警报，并向大模型下达“修不好绝不推进”的修复指令。

## 🚀 一键安装 (One-Liner Install)

如果你需要一次性部署所有插件以获得完全体 GSD Auto 体验，直接运行以下命令：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/PamelaSprin47685ghall/gsd-me/main/install.sh)
```

或单独使用 `gsd install` 分别拉取指定的插件。

## 卸载

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/PamelaSprin47685ghall/gsd-me/main/remove.sh)
```

## 为什么是“极简 (Minimalist)”？

- **无依赖 (Zero Dependency)**：只使用 Node.js 原生的模块 (`fs`, `path`, `crypto` 等) 和内建的 `node:test` 测试框架。不依赖外部库。
- **零构建 (Zero Build)**：原生的 ES Module 架构。即拉即用，完全不需要 `tsc` 编译。
- **无破坏 (Non-Destructive)**：大量应用幻影替换与拦截补丁，所有的改变仅发生在呈现给 LLM 的最终投影视角中，从不改写核心数据库或日志的本来面貌。

## 证书

MIT License
