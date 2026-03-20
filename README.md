# Claude Code Hub

A macOS desktop app for managing multiple Claude Code terminal sessions across projects.

[中文文档](./README_CN.md)

## Open Source Attribution

This repository continues development from the open-source codebase originally published by [zhanghongliang](https://github.com/hongliangzhang07/claude_code_hub). Thanks to the original author for making the project public and reusable.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/storyjack/claude_code_hub/main/install.sh | bash
```

Automatically detects Mac architecture (Intel / Apple Silicon), downloads the matching build, and installs to `/Applications`.

## Features

- **First-run dependency check and setup** — Checks Node.js, Claude Code CLI, and login state on startup, with guided install and login flow inside the app
- **Official Claude CLI auth integration** — Reuses the official Claude CLI auth state, shows login status in the title bar, and can refresh or trigger CLI login again when needed
- **Real model and effort controls** — Built-in selector for Opus 4.6 (1M context), Sonnet 4.6, and Haiku 4.5, plus Auto/Low/Medium/High/Max effort with real Claude CLI launch arguments
- **Multi-project workspace** — Manage multiple project folders side by side with per-project environment variables and session discovery
- **Multi-session project threads** — Keep multiple independent Claude Code conversations under each project, including sessions discovered from existing Claude history files
- **Normal and auto-confirm sessions** — Create either standard sessions or auto-confirm sessions per project
- **Stable thread ordering** — Running sessions stay pinned to the top, while other threads sort by latest activity instead of being randomly reshuffled
- **Session resume and deleted-session protection** — Saved Claude session IDs resume across restarts, while deleted sessions stay hidden even after rescans
- **Embedded Claude terminal** — Full in-app Claude terminal with colors, links, scrollback, restart controls, and a bottom-pinned prompt for cleaner reading
- **Keyboard shortcuts and input helpers** — Supports Cmd+A / Cmd+C / Cmd+V, Shift+Enter for newline, and selection-aware delete behavior
- **Auto-scroll and jump-to-bottom** — New output follows automatically when you are at the bottom, with a floating button to jump back down after reading history
- **Right-click session actions** — Rename, delete, and restart sessions from context actions without leaving the workspace
- **Snapshots and session replay branching** — Capture terminal snapshots, preview saved output, and start a new session from a saved terminal state
- **Full-width bottom workspace terminal** — Toggle a terminal panel that spans the full bottom of the window for local workspace shell access
- **UTF-8 and CJK-friendly terminals** — Chinese filenames and mixed CJK output render correctly in both the main session view and bottom terminal
- **Proxy passthrough on macOS** — Hub forwards macOS system proxy variables to Claude child sessions when those variables are not already set
- **Crash-safe persistence and reopen recovery** — Atomic writes reduce corruption risk, and Hub restores saved session metadata when the app window or app process is reopened

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code)
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
- Run `claude` in terminal once to complete authentication

## Post-Install Notes

- If macOS says the app is "damaged" or "can't be opened", run:
  ```bash
  xattr -cr /Applications/Claude\ Code\ Hub.app
  ```
- Alternatively, **right-click → Open** and click "Open" in the dialog

## Usage Tips

- Click the folder icon (top-left) to add a project
- Click `+` under a project to create either a normal session or an auto-confirm session
- Use the top-right selectors to choose model and effort; new sessions launch with those settings, and running sessions are relaunched with the real Claude CLI args
- Running sessions stay pinned to the top of each project; refreshing sessions will rescan disk sessions, and opening a stopped thread can relaunch it into the running group
- **Right-click** a session to rename, restart, or delete it
- Deleted sessions are remembered and will not be re-imported on the next scan
- Use the refresh button on a project to rescan Claude sessions from disk
- Use the camera button to create snapshots and start a new session from a saved terminal state
- Scroll up to see history; a floating arrow button appears to jump back to the bottom
- Toggle the bottom terminal bar to open a full-width workspace terminal
- Sessions auto-resume — restart the app and conversations pick up where they left off
- On macOS, if System Proxy is enabled, Hub automatically passes proxy env (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`) to Claude child sessions when those vars are not already set

## Local Development

```bash
git clone git@github.com:storyjack/claude_code_hub.git
cd claude_code_hub
npm install
npm run dev
```

## Build

```bash
npm run build
```

Build output is in the `dist/` directory.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron |
| Frontend | React |
| Bundler | Vite |
| Terminal | xterm.js |
| PTY | node-pty |

## License

MIT
