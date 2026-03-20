#!/bin/bash
# Build OpHub.app — a macOS .app bundle for launching from Dock/Finder
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="OpHub"
APP_DIR="$HUB_DIR/dist-app/${APP_NAME}.app"
CONTENTS="$APP_DIR/Contents"

echo "[build-app] Building ${APP_NAME}.app ..."

# Ensure frontend is built
if [ ! -d "$HUB_DIR/dist" ]; then
  echo "[build-app] Building frontend..."
  (cd "$HUB_DIR" && npx vite build)
fi

# Ensure node_modules
if [ ! -d "$HUB_DIR/node_modules" ]; then
  echo "[build-app] Installing dependencies..."
  (cd "$HUB_DIR" && npm install)
fi

# Clean previous build
rm -rf "$APP_DIR"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

# --- Launcher script (absolute path baked at build time) ---
cat > "$CONTENTS/MacOS/ophub-launcher" << LAUNCHER
#!/bin/bash
# OpHub launcher — built from: $HUB_DIR
# Baked project path (works even after copying .app to /Applications)
HUB_DIR="$HUB_DIR"

# Ensure dist exists
if [ ! -d "\$HUB_DIR/dist" ]; then
  (cd "\$HUB_DIR" && npx vite build 2>/dev/null)
fi

# Ensure node_modules
if [ ! -d "\$HUB_DIR/node_modules" ]; then
  (cd "\$HUB_DIR" && npm install --production 2>/dev/null)
fi

cd "\$HUB_DIR"
# Direct Electron binary — skip the Node.js wrapper for faster startup
ELECTRON_BIN="\$HUB_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
exec "\$ELECTRON_BIN" "\$HUB_DIR" "\$@"
LAUNCHER
chmod +x "$CONTENTS/MacOS/ophub-launcher"

# --- Info.plist ---
cat > "$CONTENTS/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.claude.ophub</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleExecutable</key>
  <string>ophub-launcher</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSUIElement</key>
  <false/>
</dict>
</plist>
PLIST

# --- Generate icon ---
# Create a simple icon using sips if no .icns exists
ICON_SRC="$HUB_DIR/resources/icon.png"
ICON_DST="$CONTENTS/Resources/icon.icns"

if [ -f "$ICON_SRC" ]; then
  # Convert PNG to icns via iconutil
  ICONSET="$HUB_DIR/dist-app/icon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 64 128 256 512; do
    sips -z $size $size "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" 2>/dev/null
    double=$((size * 2))
    if [ $double -le 1024 ]; then
      sips -z $double $double "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" 2>/dev/null
    fi
  done
  iconutil -c icns "$ICONSET" -o "$ICON_DST" 2>/dev/null || true
  rm -rf "$ICONSET"
fi

# If no icon was generated, use Electron's default
if [ ! -f "$ICON_DST" ]; then
  ELECTRON_ICON="$HUB_DIR/node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns"
  if [ -f "$ELECTRON_ICON" ]; then
    cp "$ELECTRON_ICON" "$ICON_DST"
  fi
fi

echo "[build-app] Created: $APP_DIR"
echo ""
echo "To install to Applications:"
echo "  cp -R \"$APP_DIR\" /Applications/"
echo ""
echo "Or drag dist-app/${APP_NAME}.app to your Dock."
