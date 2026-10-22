# Repo Knowledge

[English](README.md)

供开发者与编码 Agent 共同使用的代码库知识系统，面向 **Windows 和 Linux 上的 VS Code**。

## 当前状态：M1 实现预览

已实现知识卡片运行时校验、源码过期检查、词法搜索、独立 STDIO MCP 服务、不可变更新候选，以及 VS Code 搜索、诊断和 Codex 配置引导命令。附带三张自主编写的演示卡片。

可以按下面的命令构建本地 VSIX 候选包。**正式 alpha 发布仍须通过 Windows 和 Linux 的官方 Codex IDE 真实验收；协议测试不能代替该验收。** 暂无 Wiki 自动生成、候选自动发布或 Marketplace 版本。参见[M1 验收清单](docs/development/m1-acceptance.md)与[任务路线图](docs/product/roadmap.md)。

## 计划体验

用户通过 Wiki 阅读和修订项目知识，Codex 通过 MCP 检索带源码证据的知识卡片；源码改变后标记过期、生成更新候选并审阅发布。保留人工判断与来源版本。“学习”是持久化和复用项目知识，不是训练模型。

## 本地开发

Windows 与 Linux 统一使用 Node.js **24.19.0**、npm **12.2.1**：

```text
npm install --global npm@12.2.1
npm ci
npm run check
npm run build
npm run package:vsix
```

在 VS Code 中通过“从 VSIX 安装”选择 `dist/repo-knowledge-0.0.0.vsix`。依次运行 **Repo Knowledge: Open Three-Card Demo**、信任自主编写的演示目录，然后运行 **Search Cards**、**Diagnose Standalone MCP**、**Show Codex MCP Setup**。将生成的配置合并到 Codex config.toml，重启 Codex。引导命令只展示配置，不覆盖已有设置。具体步骤见[使用指南](docs/user/quickstart.zh-CN.md)。

预览验收使用外部 Node 24.19.x；PATH 中没有 Node 时，配置 `repoKnowledge.nodeExecutable` 的绝对路径。VS Code 扩展宿主的内置 Node 与该外部运行时不同。声明的 VS Code 最低版本仍是暂定值，兼容范围以实际宿主验收为准。

## 工程边界

- `packages/core`：不依赖编辑器的知识内核。
- `packages/mcp-server`：独立启动的协议服务。
- `packages/vscode-extension`：编辑器命令与打包后的独立服务。

插件不调用模型、不读取凭据。工具只读取明确配置的知识库和被引用源码；更新候选仅写入知识目录，不自行发布或修改目标源码。卡片文本属于不可信数据。不要在卡片中放置秘密，也不要向 Issue 上传私有源码。

## 参与和许可证

[贡献指南](CONTRIBUTING.md) · [支持](SUPPORT.md) · [安全报告](SECURITY.md) · [发布流程](docs/development/releasing.md)

采用 [Apache-2.0](LICENSE)。Copyright 2026 KasterMist and contributors。独立社区项目，与 OpenAI、Qoder 无官方隶属关系。
