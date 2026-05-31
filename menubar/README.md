# ntncite · menubar

macOS 菜单栏控制台(SwiftUI `MenuBarExtra`),`ntncite` sync 引擎的图形外壳。**不含同步逻辑**,
只调 CLI(`pnpm --silent sync --status/--doctor/--list` + 读 `.sync-history.jsonl`)、手动触发、
管 launchd、开链接。

## 功能

- 状态卡(同步中转圈)+ 上次同步摘要;**BBT 掉线弹橙色警告**(没 BBT 同步走不通)
- 立即同步 / 强制重推;频率分段(改 launchd 重载)+ 暂停/恢复自动同步
- 健康灯:BBT · ntn · 卷 · Notion
- 条目(每篇论文,点击跳其 Notion 页)/ 历史表 / 耗时柱状图(Swift Charts)

## 跑

```sh
swift build && .build/debug/Ntncite &     # 命令行(debug)
# 或:用 Xcode 打开 Package.swift → Run
```

菜单栏出现 📚 即成功(`.accessory` 模式,不占 Dock)。

## 开机自启

```sh
sh launchd/install.sh      # 编译 release + 拷到 ~/Library/Application Support/ntncite-bar + 装 LaunchAgent
sh launchd/uninstall.sh    # 卸
```

`install.sh` 会把同仓库 `../cli` 的路径注入到 plist 的 `NTNCITE_CLI_DIR`,App 据此找到 sync 引擎。
日志:`~/Library/Logs/ntncite-bar.log`。

## 配置在哪

路径/Notion URL 不写死,在 `Sources/Ntncite/Models.swift` 的 `AppConfig`:
- `NTNCITE_CLI_DIR`(环境变量,install.sh 注入;开发时默认 `~/Code/ntncite/cli`)
- Notion 库 URL 从 `cli/config.json` 的 `notesDataSourceId` 推导
- pnpm 路径走 `NTNCITE_PNPM` / PATH
