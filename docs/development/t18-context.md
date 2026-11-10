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

验证：锁定工具链完整检查通过 81 单测/5 集成，新增真实 Git 集成通过，
覆盖 unborn→提交、dirty 新文件、暂存、分支拒绝与切回、linked worktree 隔离。
实际 Windows 隔离 VSIX 宿主通过注册、双知识树、源码导航、审阅/恢复和独立 MCP。
宿主夹具改在系统临时目录创建，避免继承开发仓库的 Git 上下文。

同一开发包已在 Windows 隔离配置与 Linux SSH 安装并核对 bundle。首轮 CI 四项
通过，Windows 宿主发现已有草稿 dirty 检查受短文件名别名影响；改为异步比较
真实路径，保留未保存必须拒绝的断言。修正后精确 head
`2a95400ab6442d59658fd539ac7dd0d2ba65b1b9` 的
[run 42795048416](https://github.com/KasterMist/repo-knowledge/actions/runs/42795048416)
五项均通过；[PR #42](https://github.com/KasterMist/repo-knowledge/pull/42)
合并为 `db601061902d8b27b031e39050b7355cd3cd34c2`。

## 两端界面验收完成

维护者明确反馈 Windows 和 Remote SSH 全部正常：取消绑定后仍提示未绑定；
确认绑定后读取三卡片；feature 分支拒绝原存储；切回 main 恢复读取。
点击和提示由维护者反馈，不冒充独立捕获的原始界面轨迹。真实 linked worktree、
暂存区和 dirty 源码边界由另行记录的自编 Git 集成测试覆盖，不要求重复手测。

T18 本次范围退出条件已满足，进入归档关闭；下一项 T19 三方合并与人工内容保护。
本次仅文档归档，不调用模型、不操作演示源码或知识，不扩大 Linux 桌面 Codex
支持声明。M4 尚未完成，开发功能尚未发布。
