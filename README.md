# OpenCode 自定义 Agent 配置

这个目录保存的是一套用于替代 OpenCode 默认 `build` / `plan` / `explore` 的自定义 Agent 配置。

目标：

- 在 OpenCode 界面中显示自定义主代理 `行者`、`谋士`
- 禁用内置 `build`、`plan`、`general`、`explore`
- 使用 `探路`、`御史`、`明镜`、`校验`、`工匠` 作为子代理

## 文件说明

- [opencode.json](D:/codes/open-agent/opencode.json)：全局 OpenCode 配置
- [tui.json](D:/codes/open-agent/tui.json)：TUI 快捷键配置
- [.opencode/agents](D:/codes/open-agent/.opencode/agents)：自定义 Agent 定义

## 如何安装到 OpenCode 全局配置目录

将以下文件复制到 OpenCode 全局配置目录 `C:\Users\Administrator\.config\opencode`：

1. 用项目里的 [opencode.json](D:/codes/open-agent/opencode.json) 覆盖：
   - `C:\Users\Administrator\.config\opencode\opencode.json`

2. 用项目里的 [tui.json](D:/codes/open-agent/tui.json) 覆盖或新建：
   - `C:\Users\Administrator\.config\opencode\tui.json`

3. 将项目里的以下 Agent 文件复制到：
   - `C:\Users\Administrator\.config\opencode\agents\`

需要复制的文件：

- [行者.md](D:/codes/open-agent/.opencode/agents/%E8%A1%8C%E8%80%85.md)
- [谋士.md](D:/codes/open-agent/.opencode/agents/%E8%B0%8B%E5%A3%AB.md)
- [探路.md](D:/codes/open-agent/.opencode/agents/%E6%8E%A2%E8%B7%AF.md)
- [御史.md](D:/codes/open-agent/.opencode/agents/%E5%BE%A1%E5%8F%B2.md)
- [明镜.md](D:/codes/open-agent/.opencode/agents/%E6%98%8E%E9%95%9C.md)
- [校验.md](D:/codes/open-agent/.opencode/agents/%E6%A0%A1%E9%AA%8C.md)
- [工匠.md](D:/codes/open-agent/.opencode/agents/%E5%B7%A5%E5%8C%A0.md)

## 安装后验证

重启 OpenCode 后，执行：

```powershell
opencode agent list
```

预期结果：

- 能看到 `行者 (primary)`
- 能看到 `谋士 (primary)`
- 能看到 `探路`、`御史`、`明镜`、`校验`、`工匠`
- 看不到内置 `build`、`plan`、`general`、`explore`

## 说明

- `tui.json` 放在全局目录，不放在 `agents` 目录里。
- `color` 影响的是自定义 Agent 在 UI 中的标识颜色，不会把默认 `build` 标签染色。
- 因为这里是“禁用默认模式 + 启用自定义中文主代理”，所以界面里显示的是 `行者`、`谋士`，不是 `build`、`plan`。
