# Repo Knowledge

[English](README.md)

供开发者与编码 Agent 共同使用的代码库知识系统，面向 **Windows 和 Linux 上的 VS Code**。

## 当前状态：M0 工程基础

目前具备 npm/TypeScript 工作区、模块边界、贡献文档、工程检查与 Windows/Linux CI 配置。源码入口仅用于验证构建，没有产品行为。

**尚无可安装插件、MCP 服务、Wiki 生成或 Codex 集成。** 后续能力见[任务路线图](docs/product/roadmap.md)，目前没有 Marketplace 版本。

## 计划体验

用户通过 Wiki 阅读和修订项目知识，Codex 通过 MCP 检索带源码证据的知识卡片；源码改变后标记过期、生成更新候选并审阅发布。保留人工判断与来源版本。“学习”是持久化和复用项目知识，不是训练模型。

## 本地开发

Windows 与 Linux 统一使用 Node.js **24.19.0**、npm **12.2.1**：

```text
npm install --global npm@12.2.1
npm ci
npm run check
```

详见[贡献指南](CONTRIBUTING.md)与[平台支持要求](docs/product/requirements.md)。扩展宿主与外部 Node 运行时分别验证；最终用户的运行时要求和编辑器最低版本在 M1 验收后确定。

## 工程边界

- `packages/core`：不依赖编辑器的知识内核。
- `packages/mcp-server`：独立协议服务边界，M1 实现。
- `packages/vscode-extension`：编辑器交互边界，M1 实现。

M0 不调用模型，不读取凭据，不启动后台服务或扫描仓库。测试仅使用允许公开的样例，不应向 Issue 上传私有源码。

## 参与和许可证

[贡献指南](CONTRIBUTING.md) · [支持](SUPPORT.md) · [安全报告](SECURITY.md) · [发布流程](docs/development/releasing.md)

采用 [Apache-2.0](LICENSE)。Copyright 2026 KasterMist and contributors。独立社区项目，与 OpenAI、Qoder 无官方隶属关系。
