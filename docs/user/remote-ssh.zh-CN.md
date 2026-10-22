# Windows VS Code → Remote SSH → Linux

这是必需的使用场景，当前为实现预览。真实服务器的 MCP 四工具闭环已验证；Remote SSH 编辑器交互和官方 Codex 对话仍须按下方步骤验收。跟踪 [Issue #5](https://github.com/KasterMist/repo-knowledge/issues/5)。

## 运行位置

Repo Knowledge 安装在 SSH 主机侧，代码读取、知识存储和独立 MCP 进程都在 Linux。Windows 客户端负责显示编辑器界面。Codex 的执行后端也应位于同一 SSH 主机。MCP 本身不需要 SSH 密码、不开放 HTTP 端口。

在已连接服务器的 VS Code 窗口中安装候选 VSIX，确认扩展位于“SSH 主机”分组，安装后重新加载窗口。不要仅根据 Windows 本机扩展列表判断远端已安装。通过官方 Codex 的设置打开正在使用的 config.toml，确认执行环境，避免把 Linux 绝对路径放进 Windows 本地后端。

远端没有 npm 也可以使用。默认 `repoKnowledge.nodeExecutable = node` 在 Remote SSH 下会使用 VS Code Server 当前的 Node 可执行文件，以独立子进程启动 MCP；已验证的远端 MCP 运行时为 Node 22.22.1。也可在远端设置中指定独立 Node 的绝对路径。开发工具链仍固定为 Node 24.19.0/npm 12.2.1。服务器升级导致 Node 路径改变后，需要重新生成 MCP 配置。

## 首次验收

1. 打开可信的远端文件夹，运行 `Repo Knowledge: Open Three-Card Demo`。确认新窗口仍连接 SSH，演示文件在服务器缓存中，而非 Windows 磁盘。
2. 在演示窗口运行 `Repo Knowledge: Search Cards`，搜索“读取”与 `Cache.get`，核对卡片及源码引用。
3. 运行 `Repo Knowledge: Open Knowledge Snapshot`。确认打开的是同一 SSH 主机上的 knowledge.json。
4. 运行 `Repo Knowledge: Diagnose Standalone MCP`。输出应说明 ssh-remote/Linux 执行环境、Node 版本及四个工具。此成功结果只证明插件客户端与服务相通。
5. 运行 `Repo Knowledge: Show Codex MCP Setup`，核对所有路径都属于远端；合并到同一主机的活动 Codex 配置，重启 Codex。若验收演示已预置项目级 `.codex/config.toml`，核对并信任该演示项目后即可使用，无需重复追加同名表。
6. 在官方 Codex 中新建对话，输入下面的验收请求。确认界面确实显示工具调用，而不是仅生成了工具名称。

```text
请使用 Repo Knowledge MCP 验收这个演示项目：
先调用 get_knowledge_status，再 search_knowledge 搜索“读取”和“缓存”，
read_knowledge 读取三张卡片，依据证据解释缓存空字符串和未命中的区别。
然后用当前 snapshotRevision 和卡片 revision 提交一份澄清措辞的
propose_knowledge_update，保持 ID 并把 revision 加一。
不要直接修改 knowledge.json，不要运行演示源码，也不要读取目录外的内容。
```

7. 检查知识目录 proposals 中新增的候选文件，确认 knowledge.json 没有被覆盖。再以错误 baseRevision 提交一次，应得到 REVISION_CONFLICT。
8. 新开一个完全独立的 Codex 对话，再次请求读取卡片，验证跨对话复用。修改的只是复制出的演示源码时，应报告 stale，旧源码 hash 的候选应被拒绝。

## 记录结果与排错

记录 Windows/服务器架构、VS Code、Codex、Node 版本、源码提交、VSIX 校验和和工具调用结果。公开记录中删除服务器地址、账户路径及其他个人信息；凭据与用户配置不作为附件上传。

“Install Repo Knowledge on the SSH host”表示运行位置不匹配；Windows 存储路径报错表示把客户端路径用于远端；STORE_UNAVAILABLE 表示所选知识目录缺少有效 knowledge.json。缺少工具时先核对 Codex 当前后端和配置层，再重启扩展。协议诊断成功但 Codex 不调用工具，应检查 Codex 的工具可用性与权限，不能把插件诊断当作 Codex 已接入。

目前只接受原生工作区与 Linux Remote SSH；WSL、容器、其他虚拟文件系统和跨主机 MCP 代理没有经过验收。完整的 Wiki 页面、仓库自动生成和增量维护仍按 M2–M4 推进。

[VS Code 远程扩展架构](https://code.visualstudio.com/api/advanced-topics/remote-extensions) · [官方 Codex MCP 配置](https://learn.chatgpt.com/docs/extend/mcp)
