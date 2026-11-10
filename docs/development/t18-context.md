# T18 上下文隔离进度

更新：2026-11-10。跟踪 [Issue #41](https://github.com/KasterMist/repo-knowledge/issues/41)。

已实现：编辑器无关的 Git 元数据上下文、外部存储显式绑定、旧候选保守拒绝、
扫描前后和生成/重试/创建发布时的 HEAD/index 与所选源码重新校验；人工更新/
回退审阅令牌绑定上下文；提交前再次检查。MCP 复用同一 core 守卫。
VS Code 新增 Bind Repository Context，先确认再写，不自动采用旧任务。
无模型调用、分支切换或目标项目执行。

迁移与降级见 [ADR 0011](../architecture/adr/0011-repository-context.md)，
用户操作见[手册](../user/repository-context.zh-CN.md)。不提供全局 dirty 统计或
跨进程 checkout 原子锁；超界 Git 元数据保守拒绝。

验证：锁定工具链完整检查通过 81 单测/4 原集成；新增真实 Git 集成单独通过，
覆盖 unborn→提交、dirty 新文件、暂存、分支拒绝与切回、linked worktree 隔离。
实际 Windows 隔离 VSIX 宿主通过注册、双知识树、源码导航、审阅/恢复和独立 MCP。
宿主夹具改在系统临时目录创建，避免继承开发仓库的 Git 上下文。

尚待：最终合并提交的五项 CI、两端新版安装与显式绑定确认/错误上下文拒绝界面
反馈。这些门禁通过前 T18 保持开放；不声称 M4 完成或新版本已发布。
