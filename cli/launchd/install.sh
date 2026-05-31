#!/bin/sh
# 把后台自动同步装成 launchd agent。运行时推断仓库位置 / pnpm / Zotero 路径,无硬编码。
# 用法:sh launchd/install.sh [间隔秒数,默认 900=15分钟]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$HERE/.." && pwd)"            # cli 目录
LABEL="com.ntncite.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/ntncite-sync.log"
INTERVAL="${1:-900}"
PNPM="$(command -v pnpm || echo /opt/homebrew/bin/pnpm)"
PNPM_DIR="$(dirname "$PNPM")"

# 从 config.json 推 zotero.sqlite 路径(给 WatchPaths 用);拿不到就用默认 ~/Zotero
SQLITE="$(node -e 'try{const c=require(process.argv[1]);const p=String(c.zoteroDataDir||"~/Zotero").replace(/^~/,process.env.HOME);process.stdout.write(p+"/zotero.sqlite")}catch(e){process.stdout.write(process.env.HOME+"/Zotero/zotero.sqlite")}' "$PROJ/config.json" 2>/dev/null || echo "$HOME/Zotero/zotero.sqlite")"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PNPM_DIR:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-c</string>
    <string>cd "$PROJ" && exec "$PNPM" sync --auto</string>
  </array>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>WatchPaths</key><array><string>$SQLITE</string></array>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "✓ 自动同步已装($LABEL):每 $((INTERVAL/60)) 分钟 + Zotero 写库触发,无变化秒退。"
echo "  日志:$LOG   卸载:sh $HERE/uninstall.sh   改频率:sh $HERE/install.sh <秒>"
