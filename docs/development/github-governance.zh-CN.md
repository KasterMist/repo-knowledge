# GitHub 治理设置交接

2026-10-23 核对：main 的公开分支元数据仍为 protected=false。当前连接器能写源码和 PR，但没有管理设置写入接口；浏览器设置页多次读取超时。以下配置尚未完成，不能仅凭 CI 文件存在就记为已启用。跟踪 [Issue #1](https://github.com/KasterMist/repo-knowledge/issues/1)。

## main 分支保护

在 [Branches 设置页](https://github.com/KasterMist/repo-knowledge/settings/branches)新增 classic 分支保护规则（已有 main 规则则编辑，不要重复创建）：

1. 分支匹配填 main，只保护主分支。
2. 开启合并前必须经过 PR；当前只有一位维护者，不要求另一个人的批准，避免无人可批准自己的 PR。
3. 开启合并前必须通过状态检查，选择下方五个已经实际运行成功的检查。检查来源选择 GitHub Actions（如界面提供）。
4. 禁止强制推送和删除，不为日常修改设置绕过；可启用合并前分支保持最新。保存后重新进入页面确认规则及检查名称保留。

| 必需检查名称                      |
| --------------------------------- |
| check (windows-latest)            |
| check (ubuntu-latest)             |
| remote MCP runtime (Node 22.22.1) |
| editor host (windows-latest)      |
| editor host (ubuntu-latest)       |

这些名称来自 PR #10 的实际成功 CI。后续更名工作流任务时必须同步保护规则；不要故意提交破坏性改动来测试保护。[GitHub 官方分支保护说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)描述了创建规则、PR 和必需检查的设置。

## 私密漏洞报告

进入[仓库 Settings](https://github.com/KasterMist/repo-knowledge/settings)，在侧栏 Security and quality 下打开 Advanced Security，将 Private vulnerability reporting 设为启用。重新进入确认已启用即可，不要创建虚假的漏洞报告。该入口与 SECURITY.md 是不同设置。[官方操作说明](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)。

## 完成后记录

反馈“main 规则已保存，五项检查已选，私密漏洞报告已开启”，或指出具体缺失/不可操作的选项。后续再核对可访问的分支元数据并更新 Issue #1；管理员设置中无法独立读取的细节，应标明由维护者确认。无需发送密码、token、用户配置或包含凭据的截图。
