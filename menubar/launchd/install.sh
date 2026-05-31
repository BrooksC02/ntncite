#!/bin/sh
# 编译 release、拷到家目录、装成开机自启的 launchd agent(菜单栏常驻)。
# 不含任何硬编码个人路径:仓库位置 / 用户 / pnpm 都在运行时推断。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$HERE/.." && pwd)"            # menubar 目录
CLI_DIR="$(cd "$PROJ/../cli" && pwd)"     # 同仓库的 cli(sync 引擎)
LABEL="com.ntncite.menubar"
DEST="$HOME/Library/Application Support/ntncite-bar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/ntncite-bar.log"
PNPM_DIR="$(dirname "$(command -v pnpm || echo /opt/homebrew/bin/pnpm)")"

echo "→ 编译 release…"
( cd "$PROJ" && /usr/bin/swift build -c release )

mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$PROJ/.build/release/Ntncite" "$DEST/Ntncite"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$DEST/Ntncite</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$PNPM_DIR:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NTNCITE_CLI_DIR</key><string>$CLI_DIR</string>
    <key>NTNCITE_PNPM</key><string>$PNPM_DIR/pnpm</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST" 2>/dev/null || true
pkill -f 'ntncite-bar/Ntncite' 2>/dev/null || true
sleep 1
launchctl load -w "$PLIST"

echo "✓ 菜单栏 App 已装并开机自启($LABEL)。菜单栏应出现 📚。"
echo "  · 更新:改完代码重跑本脚本;日志:tail -f $LOG;卸载:sh $HERE/uninstall.sh"
