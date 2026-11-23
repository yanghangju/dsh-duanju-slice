# 配置切片工作台运行环境

仅在工作台发来的环境配置请求中执行；请求包含一个配置请求 ID。没有 ID 时请用户从工作台发起，不安装任何东西。本会话不执行剪辑。

用通用 Shell 工具运行本 Skill 目录内的 `setup.mjs`，唯一参数是该请求 ID。不要用 Git、自己执行安装命令或改动脚本。脚本先复用并检查本机 Python 和卡点依赖、FFmpeg、FFprobe；缺失时沿用原来的 NuGet、清华 PyPI 和 `yanghangju/runtime` 下载流程与代理设置，验证和登记路径后才报告成功。

- Windows 用 `pwsh`。把下面的脚本路径替换为 Skill 资源目录中的绝对路径，保留单引号；把 `REQUEST_ID` 替换为请求里的 ID。

  ```powershell
  $node = $env:DSH_NODE_EXECUTABLE
  if ($node) { $env:ELECTRON_RUN_AS_NODE = '1' } else { $node = 'node' }
  & $node 'C:\绝对路径\setup.mjs' 'REQUEST_ID' | Write-Output
  exit $LASTEXITCODE
  ```

- 其他平台用 `bash`：`ELECTRON_RUN_AS_NODE=1 "${DSH_NODE_EXECUTABLE:-node}" '/绝对路径/setup.mjs' 'REQUEST_ID'`。缺少工具时脚本会说明平台限制。
- 用 Shell 的后台任务模式（`run_in_background: true`），等待并获取最终任务输出再答复；仍在运行不算完成。如果 Shell 沙箱阻止写入本机配置目录或启动安装子进程，按 Shell 自身的审批流程，仅对这条原命令申请所需权限，不绕过审批。
- 仅在脚本退出成功且输出 `ready: true` 时告知配置完成，按工作台请求给出返回指引。失败就说明最终输出里的原因，不自行重跑同一请求。
