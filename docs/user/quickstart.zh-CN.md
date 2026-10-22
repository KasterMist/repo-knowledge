# M1 使用指南

这是知识检索与修改候选的实现预览。完整 Wiki 界面、自动生成、候选审阅发布、增量维护属于后续阶段。

## 安装与演示

1. 开发机准备 Node 24.19.0 / npm 12.2.1，执行 `npm ci`、`npm run check`、`npm run build`、`npm run package:vsix`。
2. VS Code 命令面板选择“从 VSIX 安装”，安装 dist 中的候选包。无需管理员权限。扩展不在商店发布。
   也可以从对应 PR 的成功 Actions 运行中下载 `repo-knowledge-candidate-windows-latest` 或 `repo-knowledge-candidate-ubuntu-latest`，解压后按 SHA256SUMS 核对 VSIX。两者是同一跨平台实现的测试候选，保留 7 天，不是正式 Release。
3. 运行 `Repo Knowledge: Open Three-Card Demo`。它将内置的自主编写示例复制到扩展外部存储，在新窗口打开；已有演示目录不会覆盖。演示源码只供读取。
4. 信任演示文件夹，运行 `Repo Knowledge: Search Cards`，搜索“读取”“缓存”或 `Cache.get`，查看卡片与证据状态。
5. 外部 Node 不在 PATH 中时，在用户设置配置 `repoKnowledge.nodeExecutable` 的绝对路径。运行 `Repo Knowledge: Diagnose Standalone MCP`。成功表示本插件的客户端完成了协议握手，不表示 Codex 已连接。

## 连接官方 Codex 扩展

运行 `Repo Knowledge: Show Codex MCP Setup`，将显示的完整 TOML 表合并到用户 `~/.codex/config.toml` 或可信项目的 `.codex/config.toml`。若已有同名表，替换该表，不要重复追加。该命令不编辑你的配置。通过 Codex MCP 设置重启扩展，在新会话中明确要求调用四个知识工具。

配置包含已安装扩展目录的绝对路径。扩展升级、移动或重装后重新生成配置。默认 `repo_knowledge` 绑定一个明确的代码目录和知识目录；多仓库请使用不同表名，并核对路径。此预览不为 WSL、SSH 或云端提供路径映射。

[官方 MCP 说明](https://learn.chatgpt.com/docs/extend/mcp)确认了 Codex 的 STDIO、config.toml 和 IDE 接入方式。`.vscode/mcp.json` 的配置不能代替 Codex 配置。配置成功不保证 Agent 每轮主动调用；建议在项目 AGENTS.md 中明确按需检索知识及核查证据的约定。

## 自己的项目与候选

运行 `Repo Knowledge: Initialize External Store` 创建空快照，再用 `Open Knowledge Snapshot` 编辑；默认目录在 VS Code 扩展存储中，按代码目录隔离。也可设置绝对 `repoKnowledge.storeDirectory`，指向包含 knowledge.json 的共享目录。多根工作区会要求选定目标。初始化不会覆盖已有快照。

首批卡片目前手动编写，可参照 examples/demo/knowledge/knowledge.json；必填 stable ID、revision、kind、scope、源码路径/行号/SHA-256。SHA-256 对整个 UTF-8 源文件计算，先把 CRLF 规范成 LF；不是单个片段的 hash。修改 knowledge.json 前自行备份并保留 Git 历史。完整格式和回退规则见 [ADR 0002](../architecture/adr/0002-knowledge-snapshot.md)。

Agent 使用 `read_knowledge` 返回的 snapshotRevision 和卡片 revision 调用 `propose_knowledge_update`，proposedCard 保持 ID、revision 加一并引用当前源码。候选写到知识目录 `proposals/<UUID>.json`，不会覆盖 knowledge.json。可在编辑器打开该 JSON 检查原因和拟议内容。M1 无自动发布按钮；请勿把成功保存候选当作已合并知识。候选即使成功保存，后续发布仍需重新检查基础版本与源码。

源码变更、删除、不可读、路径越界或引用失效会显示 stale。此时卡片仍可查看，但不能将旧结论当作已验证事实。词法搜索支持中文子串和代码符号；不承诺语义召回率。工具读取内容会进入调用它的 Agent 上下文，知识中不要放凭据或其他不应提供给 Agent 的信息。

## 卸载与恢复

卸载前备份外部知识目录。移除 Codex 中对应 MCP 表即可停止服务接入。扩展卸载不保证自动删除外部目录；知识备份和删除由用户管理。M1 不自动迁移未知 schemaVersion；版本回退应同时恢复匹配的快照备份。
