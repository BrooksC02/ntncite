#!/bin/sh
LABEL="com.ntncite.menubar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
pkill -f 'ntncite-bar/Ntncite' 2>/dev/null || true
echo "✓ 已卸载菜单栏 App 的自启(并退出当前实例)。"
