# Repo Knowledge

[English](README.md)

供开发者与编码 Agent 共同使用的代码库知识系统，面向 **Windows 和 Linux 上的 VS Code**。
**Windows VS Code 通过 Remote SSH 连接 Linux 是必需场景**，见[远程接入与验收指南](docs/user/remote-ssh.zh-CN.md)。

## 当前状态：M1 alpha 已发布

已实现知识卡片运行时校验、源码过期检查、词法搜索、独立 STDIO MCP 服务、不可变更新候选，以及 VS Code 搜索、诊断和 Codex 配置引导命令。附带三张自主编写的演示卡片。

从 GitHub Release 下载 [v0.1.0-alpha.1](https://github.com/KasterMist/repo-knowledge/releases/tag/v0.1.0-alpha.1)，使用“从 VSIX 安装”安装 repo-knowledge-0.1.0.vsix。**M1 已完成 Windows 原生 Codex 与 Windows Remote SSH 到 Linux 的接入预览**，并通过 Windows/Linux 公开包下载安装验证。插件产品版本为 0.1.0，知识 schema 为 1。 Linux 原生编辑器宿主 CI 与 Linux 桌面 Codex 是不同证据；后者尚未验证，不纳入首个 alpha 的兼容声明。协议测试不能代替真实 Codex 对话验收。已发布的 M1 包不含 Wiki 生成或候选审阅发布界面；尚无 Marketplace 版本。参见[项目任务与进度总表](docs/development/project-status.zh-CN.md)、[M1 验收清单](docs/development/m1-acceptance.md)与[任务路线图](docs/product/roadmap.md)。

## 计划体验

M2 实现与本次范围验收已完成：按源码范围组织的 Wiki/卡片浏览、证据跳转、人工 JSON 草稿、候选差异、确认发布与修订递增的回退。Windows 原生/Remote SSH 界面反馈、独立历史与正文核对及 Windows/Linux 实际编辑器 CI 见 [M2 验收记录](docs/development/m2-acceptance.md)。这些功能尚未包含在公开 M1 包中，也尚无单独的 M2 Release。操作见[工作台指南](docs/user/workbench.zh-CN.md)；用户主动发起生成属于 M3。

由用户决定是否生成 Wiki 和知识卡片，并主动选择范围、发起生成。用户通过 Wiki 阅读和修订项目知识，Codex 通过 MCP 检索带源码证据的知识卡片。源码改变后可检查过期状态；重新生成和增量更新也由用户主动发起，生成候选后经用户审阅确认再发布。保留人工判断与来源版本。“学习”是持久化和复用项目知识，不是训练模型。

M3/T14 开发代码已提供用户主动发起的范围、排除、语言与限额选择、静态扫描预览和外部元数据规划保存；尚不调用模型或生成知识。见[生成指南](docs/user/generation.zh-CN.md)与 [M3 进度](docs/development/m3-acceptance.md)。

M3 开发版已接入校验后的新卡片审阅/发布，以及明确确认后执行的 Generate Knowledge Candidate 命令。Windows 与 Remote SSH 自编演示已真实生成待审阅候选，正式知识不变。已实现元数据任务记录及 Recover or Retry Generation Job；两端结果找回及新批次发布/移除界面已验收；无结果重试与进度取消仍待验收。手动导入未启用。详见[生成指南](docs/user/generation.zh-CN.md)、[ADR 0007](docs/architecture/adr/0007-reviewed-creation.md) 与 [ADR 0008](docs/architecture/adr/0008-explicit-codex-generation.md)。

## 本地开发

Windows 与 Linux 统一使用 Node.js **24.19.0**、npm **12.2.1**：

```text
npm install --global npm@12.2.1
npm ci
npm run check
npm run build
npm run package:vsix
```

在 VS Code 中通过“从 VSIX 安装”选择 `dist/repo-knowledge-0.1.0.vsix`。依次运行 **Repo Knowledge: Open Three-Card Demo**、信任自主编写的演示目录，然后运行 **Search Cards**、**Diagnose Standalone MCP**、**Show Codex MCP Setup**。将生成的配置合并到 Codex config.toml，重启 Codex。引导命令只展示配置，不覆盖已有设置。具体步骤见[使用指南](docs/user/quickstart.zh-CN.md)。

原生预览使用外部 Node 24.19.x；Remote SSH 默认以服务器上的 VS Code Server Node 启动独立 MCP 子进程，远端 MCP 已在 Node 22.22.1 验证，不要求 npm 或系统级安装。设置 `repoKnowledge.nodeExecutable` 的绝对路径可覆盖默认行为。声明的 VS Code 最低版本仍为暂定值，已验证编辑器基线为 1.117.0；官方 Codex 与 Remote SSH 证据见验收记录。

## 工程边界

- `packages/core`：不依赖编辑器的知识内核。
- `packages/mcp-server`：独立启动的协议服务。
- `packages/vscode-extension`：编辑器命令与打包后的独立服务。

开发版生成命令只在确认后发送明确选定的已保存源码包，使用独立受限 Codex 任务，保存待审阅候选而不自动发布。显式[后端诊断](docs/user/codex-backend.zh-CN.md)仍只查询配置/账户元数据，不创建线程或调用模型。两种流程均不复制令牌、不改登录或提供方配置。知识工具读取明确配置的知识库和被引用源码；更新候选仅写入知识目录，不自行发布或修改目标源码。卡片文本属于不可信数据。不要在卡片中放置秘密，也不要向 Issue 上传私有源码。

## 参与和许可证

[贡献指南](CONTRIBUTING.md) · [支持](SUPPORT.md) · [安全报告](SECURITY.md) · [发布流程](docs/development/releasing.md)

采用 [Apache-2.0](LICENSE)。Copyright 2026 KasterMist and contributors。独立社区项目，与 OpenAI、Qoder 无官方隶属关系。
