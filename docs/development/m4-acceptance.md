# M4 / T20 有界单卡增量维护 beta 验收

更新：2026-11-11。跟踪 [Issue #47](https://github.com/KasterMist/repo-knowledge/issues/47)。

T17–T20 **本次有界单卡范围验收完成，尚未发布**。覆盖 Windows 原生和 Windows
Remote SSH 到 Linux；不扩大原生 Linux 桌面 Codex 声明，不代表全库多轮生成或
任意仓库知识质量。下一项 T21 自然任务与知识沉淀效果评估。

## 实现与自动化

T17 变更/影响报告、T18 分支/工作树绑定、T19 人工内容保护的证据分别保留在
[T17](t17-impact-core.md)、[T18](t18-context.md)、[T19](t19-merge.md)。T20 补齐
Generate Card Update：用户确认当前范围及一张已有卡片后，复用受限后端提交
一个生成任务，只保存同 ID、当前证据的更新候选。发布仍需单独审阅确认；
Recover Incremental Result 不调用模型或自动重试。新增卡片的 new-ID 限制保持不变。

[PR #48](https://github.com/KasterMist/repo-knowledge/pull/48) 精确 head
`6e10d17d884d9d2e7fd552a8d6ac417a1d029fbe` 在
[run 42986653504](https://github.com/KasterMist/repo-knowledge/actions/runs/42986653504)
五项 CI 全通过，合并为 `bb8145051062d7667ce335df923f2f6cd70136a1`。
锁定完整检查通过 93 单测/5 集成；实际 Windows 隔离 VSIX 宿主通过新命令守卫和
原有工作台/恢复流程。无规划、仓库内存储及真实外部空结果分别有拒绝断言。

确定性回复夹具覆盖影响报告→更新候选→重复找回→审阅发布→源码一致回退、
其他卡片不变、错误 ID/引用、失败脱敏、取消不留候选和稳定 ID 独占写入。
协议 peer 另测请求尝试计数及本地预算拒绝为零。模拟回复不计真实模型验收。
格式、限额与降级见 [ADR 0013](../architecture/adr/0013-incremental-attempts.md)。

两端同一 VSIX/安装 bundle 已核对，VSIX SHA-256：
`40f98f2484e5a0740f0a5702ae39bb5e010e81c693c901f31f9c6c69e70af56d`。

## 真实生成、耗时与失败记录

独立自编 Git 夹具先保存三卡片/r1 基线，再仅将读取函数的 `??` 改为 `||`。
静态报告确认 read-fallback 直接证据失效，其余两卡不受影响。用户选择新规划后
显式确认真实生成。两份候选均正确解释空字符串现在触发缺省值，引用行号和
当前哈希经独立校验；候选保存时正式快照字节未变、历史为空。

| 成功尝试            | Windows 原生                         | Remote SSH / Linux                   |
| ------------------- | ------------------------------------ | ------------------------------------ |
| 尝试/候选 ID        | 14532fc8-39ec-4c87-b345-cd0e8dd9404f | 2e911a65-19df-44b0-ae09-3f3e54092ed0 |
| 任务总耗时          | 24,847 ms                            | 20,867 ms                            |
| turn/start 请求尝试 | 1                                    | 1                                    |
| 观察 token 数       | 6,275                                | 6,492                                |
| 保存状态            | pending-review，r2                   | pending-review，r2                   |

这些是成功任务的观察数据，不是费用或完整账单调用数。Windows 共保留 4 次
尝试：1 saved、2 failed、1 cancelled/期限结束，记录的请求尝试总数为 4。
早期失败包含 TURN_FAILED/network；未知 token 为 null，不能推定零用量。
SSH 保留 1 次 saved 尝试、请求尝试数 1。

Windows 失败窗口配置了实际存在的 CLI 0.164.0-alpha.11.1，失败在生成网络阶段，
不是未发现后端。无认证固定官方首页对照中，直连超时，既有 Windows 系统代理
得到 HTTP 200。新隔离进程仅通过子进程环境沿用该代理后得到真实生成成功，
未改持久代理、模型、provider 或登录，未复制 token。此对照支持本次宿主路由
差异，不保证任意提供方/网络可用性。产品仍继承宿主环境，不会自动将 Windows
系统/编辑器代理桥接到 Codex；普通安装体验继续在 T22 验证。

## 发布、MCP 与源码一致回退

维护者明确确认两端发布取消/确认均正常：read-fallback r1→r2、stale=false，
其余两卡仍 r1。独立检查每端恰有一条 committed publish，更新正文与源码相符；
哈希核对后的实际安装 MCP status/search/read 返回 r2/current 和同一快照。

随后仅在目录、历史与哈希均匹配后恢复各自自编源码的备份原始字节，知识快照
没有手工改写。源码未恢复时旧证据回退会拒绝，此保护未放宽；本次证明的是
源码一致回退，不是强制恢复过期事实。维护者确认查看差异并确认回退后，两端
MCP 均为 r3、stale=false。

最终独立只读核对：每端两条 committed 历史（publish、rollback）；原卡片全部
字段恢复、仅修订为 r3；其余两卡与原始内容一致；源码与备份逐字节一致。
实际安装 MCP status/search/read 返回 r3/current，片段使用 `??`，快照与内核
匹配。两端规范快照 SHA-256 相同：
`5ec3b0b2fcd2bf12a9c40a7228f84744c2a711635ee06349967f56635d6226d7`。
成功任务重复找回均为 previously-published/modelStarted=false，不会再次生成或发布。

界面点击、取消和确认由维护者反馈；文件/历史/证据及 MCP 协议另有独立检查。
这不冒充新一轮官方 Codex 聊天轨迹，M1 官方接入证据单独保留。检查与源码恢复
未执行目标源码、测试、构建或基准，也未新增模型请求。

## 兼容与后续

以旧 schema-1 三卡片为起点，显式绑定新外部存储；新增尝试元数据与格式-2
候选可读取/找回，历史回退已完成。没有自动迁移/降级覆盖，缺失历史基线的旧
建议不能被伪造为可合并候选。完整干净安装、升级和卸载矩阵属于 T22。
独立文章层级、全库多轮生成、其他 Agent 实际接入和原生 Linux 桌面 Codex 仍不
属于本次已验证声明。没有新增 tag/Release/Marketplace，旧 M1 alpha 不变。
