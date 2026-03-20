# Claude Code Hub

macOS 桌面应用，用于管理多个项目的 Claude Code 终端会话。

[English](./README.md)

## 开源来源说明

本仓库在 [zhanghongliang](https://github.com/hongliangzhang07/claude_code_hub) 公开发布的开源代码基础上继续演进，感谢原作者开放代码，延续开源共享精神。

## 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/storyjack/claude_code_hub/main/install.sh | bash
```

自动检测 Mac 架构（Intel / Apple Silicon），下载对应版本并安装到 `/Applications`。

## 功能

- **首次启动环境检查与引导设置** — 启动时检查 Node.js、Claude Code CLI 和登录状态，并在应用内提供安装和登录引导
- **官方 Claude CLI 认证集成** — 复用官方 Claude CLI 的认证状态，在标题栏展示登录信息，并支持再次刷新或触发 CLI 登录
- **真实模型与推理强度控制** — 内置 Opus 4.6（1M context）、Sonnet 4.6、Haiku 4.5 选择器，以及 Auto/Low/Medium/High/Max 推理强度，并通过真实 Claude CLI 参数生效
- **多项目工作区** — 同时管理多个项目目录，支持项目级环境变量和会话自动发现
- **多会话项目线程** — 每个项目下可以并行维护多个独立 Claude Code 会话，也能自动发现已有 Claude 历史会话
- **普通会话与自动确认会话** — 每个项目可创建标准会话或自动确认会话
- **稳定线程排序** — 运行中的会话始终置顶，其他线程按最近活跃时间排序，而不是被随机打乱
- **会话恢复与删除保护** — 已保存的 Claude 会话 ID 可跨重启恢复，已删除会话在重新扫描后也不会被重新导入
- **内嵌 Claude 终端** — 提供完整的应用内 Claude 终端，支持颜色、链接、滚动回看、重启控制，并让输入区更贴近底部便于阅读
- **快捷键与输入辅助** — 支持 Cmd+A / Cmd+C / Cmd+V、Shift+Enter 换行，以及选中内容后的删除行为
- **自动滚动与一键回底部** — 位于底部时会自动跟随新输出，向上翻阅后可通过浮动按钮快速回到底部
- **右键会话操作** — 可直接通过右键菜单重命名、删除或重启会话
- **快照与会话回放分支** — 支持抓取终端快照、预览保存内容，并基于保存下来的终端状态启动一个新会话
- **全宽底部工作区终端** — 可切换一个横跨整个窗口底部的终端面板，用于当前工作区的本地 Shell
- **UTF-8 与中文友好终端** — 中文文件名和中英混排输出在主会话区与底部终端里都能正确显示
- **macOS 代理透传** — 当系统代理变量尚未设置到会话环境时，Hub 会把 macOS 系统代理环境传递给 Claude 子进程
- **崩溃安全持久化与重开恢复** — 通过原子写入降低数据损坏风险，并在重新打开窗口或重新启动应用后恢复已保存的会话元数据

## 前置依赖

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code)
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
- 首次在终端运行 `claude` 完成登录认证

## 安装后注意

- 如果 macOS 提示"已损坏"或"无法验证开发者"，执行：
  ```bash
  xattr -cr /Applications/Claude\ Code\ Hub.app
  ```
- 或者 **右键 → 打开**，在弹窗中点击"打开"

## 使用技巧

- 点击左上角文件夹图标添加项目
- 每个项目下点 `+` 可以创建普通会话或自动确认会话
- 使用右上角模型和推理强度选择器；新会话会按所选配置启动，运行中的会话会用真实 Claude CLI 参数重新拉起
- 运行中的会话会固定在项目顶部；刷新会话会重新扫描磁盘会话，点开已停止的旧线程时会把它重新拉起到运行分组
- **右键**会话可以重命名、重启或删除
- 已删除的会话会被记住，下次扫描时不会重新导入
- 使用项目右侧的刷新按钮可以重新扫描磁盘上的 Claude 会话
- 使用相机按钮可以创建快照，并基于保存的终端状态启动一个新会话
- 向上滚动后右下角会出现箭头按钮，点击回到底部
- 切换底部终端栏可以打开横跨全宽的工作区终端
- 会话支持自动恢复，重启应用后会自动续上之前的对话
- 在 macOS 上，如果系统代理已开启，Hub 会在这些变量尚未设置时，自动把 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 传给 Claude 子进程

## 本地开发

```bash
git clone git@github.com:storyjack/claude_code_hub.git
cd claude_code_hub
npm install
npm run dev
```

## 手动构建

```bash
npm run build
```

构建产物在 `dist/` 目录下。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron |
| 前端 | React |
| 构建工具 | Vite |
| 终端模拟 | xterm.js |
| PTY 进程 | node-pty |

## License

MIT
