# Codex 生成后端诊断（T15 开发中）

此命令用于验证独立 Codex 进程的协议与配置，不是已有四工具 MCP 的诊断，也不验证模型生成质量。当前不创建模型对话、不读取待生成源码，不生成或发布知识。

## 运行

在受信任的 Windows 或 Remote SSH 工作区运行 **Repo Knowledge: Diagnose Generation Backend**。命令从当前扩展宿主启动进程，使用外部扩展存储中的临时工作目录；不会把目标仓库作为 Codex 工作目录。远端窗口应显示 ssh-remote/linux。

默认尝试从当前宿主可见的官方 Codex 扩展目录定位 Windows/Linux x64 可执行文件，不调用扩展的私有会话接口。扩展可见并不保证路径有效、账户可查询或模型可用。若无法发现，请在该宿主设置 **repoKnowledge.codexExecutable**，填写可直接运行的 Codex 文件绝对路径；Windows 不使用 .cmd/.bat/.ps1 包装脚本。原生窗口使用 Windows 路径，SSH 使用 Linux 路径。本设置不会更改 Codex 的模型、provider 或登录配置。

进度通知支持取消。结果为只读 JSON，不保存原始配置、RPC 内容、账户邮件、令牌、stderr 或后端原始错误文本。空临时目录会尝试移除；非空目录不会递归删除。

## 解读结果

| 字段/状态                 | 含义                                                     |
| ------------------------- | -------------------------------------------------------- |
| checks.initialized        | 当前进程完成协议握手                                     |
| checks.configurationRead  | 有效配置读取成功，仅保留脱敏摘要                         |
| checks.shellToolsDisabled | 后端确认当前诊断进程 shell_tool=false                    |
| checks.accountRead        | account/read(refreshToken=false) 返回可解析结果          |
| status=configured         | 独立进程返回已配置账户或外部认证状态；不等于验证模型访问 |
| status=not-authenticated  | 当前独立进程返回 account=null 且需要 OpenAI 认证         |
| status=unverified         | 某一步尚未确认，应结合 error.phase/code/reason 排查      |
| generationVerified=false  | 本诊断没有进行真实生成，始终保留此区别                   |

`REQUEST_TIMEOUT` 表示该阶段超过 15 秒；超时会终止本次客户端，不自动重试。`RPC_REJECTED` 保留数值错误码及粗粒度原因（authentication/network/unsupported/overloaded/unknown），不显示原始错误消息。`PROCESS_START_FAILED`、`PROCESS_EXITED`、`PROTOCOL_ERROR` 和限额错误分别指进程启动/退出、协议格式或资源上限。原有 MCP 检索和知识快照不因此改变。

查询失败不能据此推定官方 Codex 扩展已经退出登录，独立 SSH 进程和 VS Code 扩展宿主的环境可能不同。本插件不代为登录、不刷新或复制令牌，不接受后端发来的令牌刷新、审批等服务器请求。请先核对可执行文件、宿主和错误阶段，保留脱敏结果供排查。

## 当前边界

客户端依照官方 app-server 的 STDIO JSONL 接口实现，该接口仍在演进；以实际测试版本与运行结果为准。请求、消息和输出量均有上限，失败/取消后不把部分结果描述为成功。配置诊断也不证明其他工具均已禁用，不能单凭 shell_tool=false 就开始不受限的生成。

后续 T15 将增加受限源码包、结构化新卡片候选与审阅，T16 增加模型调用预算、取消和恢复。当前没有“生成后自动发布”的路径；创建新卡片的发布与回退保护也必须完成后才能开放正式生成闭环。
