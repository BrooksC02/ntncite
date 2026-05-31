#!/bin/sh
LABEL="com.ntncite.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "✓ 已卸载自动同步($LABEL)。手动 pnpm sync 不受影响。"
