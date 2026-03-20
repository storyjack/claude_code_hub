#!/bin/bash
# ─────────────────────────────────────────────
# ophub 一键安装脚本
# 从 GitHub 克隆并配置 Claude Code Hub
# 用法: bash install.sh
# ─────────────────────────────────────────────
set -e

REPO_URL="https://github.com/storyjack/claude_code_hub.git"
INSTALL_DIR="$HOME/.ophub"
BIN_LINK="/usr/local/bin/ophub"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     Claude Code Hub 安装程序         ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. 检查前置依赖 ──────────────────────────
check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo "[错误] 未找到 $1，请先安装："
    echo "       $2"
    exit 1
  fi
}

check_dep "git"   "xcode-select --install"
check_dep "node"  "brew install node  或  https://nodejs.org"
check_dep "npm"   "随 Node.js 一起安装"

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "[错误] Node.js 版本过低 ($(node -v))，需要 >= 18"
  echo "       brew install node"
  exit 1
fi

echo "[✓] 依赖检查通过 (node $(node -v), npm $(npm -v))"

# ── 2. 检查 Claude Code CLI ──────────────────
if command -v claude &>/dev/null; then
  echo "[✓] Claude Code CLI 已安装 ($(claude --version 2>/dev/null || echo 'installed'))"
else
  echo "[警告] Claude Code CLI 未安装"
  echo "       安装后 ophub 才能正常连接会话"
  echo "       安装: npm install -g @anthropic-ai/claude-code"
  echo ""
fi

# ── 3. 克隆或更新代码 ────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[→] 更新已有安装..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || {
    echo "[警告] git pull 失败，尝试重新克隆..."
    cd /
    rm -rf "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  }
else
  if [ -d "$INSTALL_DIR" ]; then
    echo "[→] 清理旧安装目录..."
    rm -rf "$INSTALL_DIR"
  fi
  echo "[→] 克隆代码到 $INSTALL_DIR ..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── 4. 安装依赖 ──────────────────────────────
echo "[→] 安装 npm 依赖..."
npm install 2>&1 | tail -3

# ── 5. 构建前端 ──────────────────────────────
echo "[→] 构建前端..."
npx vite build 2>&1 | tail -5

# ── 6. 创建 ophub 命令 ──────────────────────
echo "[→] 创建 ophub 命令..."
chmod +x "$INSTALL_DIR/bin/ophub"

# 创建 /usr/local/bin 如果不存在
if [ ! -d "/usr/local/bin" ]; then
  sudo mkdir -p /usr/local/bin
fi

# 创建符号链接
if [ -L "$BIN_LINK" ] || [ -f "$BIN_LINK" ]; then
  echo "    移除旧链接..."
  sudo rm -f "$BIN_LINK"
fi
sudo ln -s "$INSTALL_DIR/bin/ophub" "$BIN_LINK"

echo "[✓] ophub 已链接到 $BIN_LINK"

# ── 7. 验证安装 ──────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo "  安装完成！"
echo "════════════════════════════════════════"
echo ""
echo "  使用方法:"
echo "    ophub              打开 Hub"
echo "    ophub ~/myproject  打开并定位到项目"
echo ""
echo "  更新:"
echo "    cd $INSTALL_DIR && git pull && npm install && npx vite build"
echo "    或重新运行: bash install.sh"
echo ""
echo "  卸载:"
echo "    sudo rm -f $BIN_LINK"
echo "    rm -rf $INSTALL_DIR"
echo ""
