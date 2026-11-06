# 依赖基线和变更报告（T17 开发中）

## 报告导航

保持只读变更报告为活动编辑器，运行 **Repo Knowledge: Open Impact Report Target**，选择列表中的源码路径或卡片。源码在当前宿主打开；卡片以只读 JSON 显示正文、证据和 stale 状态。导航离开报告后，请先切回报告标签再运行该命令。

已删除的路径会明确提示不存在，不会自动改跳可能的新路径。若希望查看改名后的文件，应明确选择其新路径。导航仅接受该报告中登记的路径和卡片；知识快照、工作区或插件配置变化后请重新打开报告。报告关闭后导航上下文释放，最多保留 20 份报告。导航不会修复引用、调用模型或发布。

在受信任的仓库运行 Plan Knowledge Generation，检查扫描范围，然后运行 Capture Dependency Baseline。命令只保存元数据，不生成知识；必须使用源码仓库外的知识目录。相同规划不能覆盖保存，刷新基线请重新规划；旧基线保留。

源码发生变化后，主动运行 Review Knowledge Changes，选择基线。只读 JSON 中 changes 列出文件变化，cards 区分 invalid-evidence（直接证据变化/缺失/越界）、potential-impact（范围内变化）、unknown（覆盖不足）和 current。files 列出变更文件的 evidenceCardIds 与 scopeCardIds 反向依赖。范围潜在影响不代表已有结论一定错误。

未保存编辑会阻止命令。可在进度通知取消；知识快照或仓库身份改变时拒绝比较，请检查后捕获新基线。报告不会启动模型、更新卡片或发布。扫描受既有文件/字节限制；不完整覆盖不会报告全部有效。这不是分支隔离、语义调用图或改名历史推断。

基线位于外部 dependency-baselines，最多 100 份、每份 1 MiB，不包含正文或源码。校验失败请保留文件检查；不要手改校验和绕过拒绝。升级/降级前备份完整知识目录。格式和回退规则见 [ADR 0010](../architecture/adr/0010-dependency-baseline-storage.md)。两端无变化报告界面已验收，变化报告界面仍待验收。possibleRenames 仅在完整覆盖且前后哈希均唯一时提示可能改名；原有 added/deleted 与旧证据失效仍保留，不会自动修改引用。
