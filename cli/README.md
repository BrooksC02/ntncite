# ntncite · cli (sync engine)

> The command & contract reference. The commands below are bash (language-neutral); the prose annotations are in Chinese. For the full English overview, architecture, and one-step setup, see the [repo root README](../README.md).

把 Zotero 在读文献(有笔记的论文)单向同步到 Notion 的「Library」库:**一篇论文一行**,
题录元数据进属性,该论文的多条笔记各自成块进正文。独立 TS/Node 脚本,写入走 **ntn**
(Notion 官方 CLI,以你本人身份认证——不需要 integration token)。幂等。

> 完整介绍 / 架构 / Notion 库 schema / 一键 setup 见**仓库根目录的 README**。这里只列命令与契约。

## 配置

`cp config.example.json config.json`,填:
- `zoteroDataDir`:Zotero 数据目录(默认 `~/Zotero`)
- `notion.notesDataSourceId`:目标库的 data source id(`pnpm setup-db` 可自动建库 + 回填)

## 命令

```bash
pnpm install
pnpm sync --dry-run          # create/update/skip 计划,不写 Notion
pnpm sync                    # 全量同步(按 Zotero Item Key 去重)
pnpm sync --force            # 强制重推(刷新所有元数据)
pnpm sync --citekey <ck>     # 只同步某篇
pnpm sync --auto             # 自动模式:无变化秒退 / Zotero 没开优雅跳过(launchd 用)

# 只读诊断
pnpm sync --inspect          # 读取 + 过滤 + 论文分组清单
pnpm sync --audit            # 聚合正文块类型审计
pnpm sync --json             # PaperRecord(含 blocks)JSON

# 给菜单栏 App 的契约(纯 JSON)
pnpm --silent sync --status  # 快照
pnpm --silent sync --doctor  # 健康:volume / bbt / ntn / notion
pnpm --silent sync --list    # 论文条目(含 notionPageId)

pnpm typecheck
```

## 后台自动同步(launchd)

```bash
sh launchd/install.sh [间隔秒,默认 900]   # 装:每 15 分钟 + Zotero 写库触发 + 登录自启
sh launchd/uninstall.sh                    # 卸
```

`install.sh` 运行时按仓库位置 / 当前用户 / pnpm 位置**动态生成 plist**(无硬编码)。
日志:`~/Library/Logs/ntncite-sync.log`。

## 幂等 / 限制

- 去重主键 = Notion 侧 `Zotero Item Key`;`Content Hash`(聚合正文 hash)判断 create/skip/update。
- 只同步**有笔记的论文**(= 在读)。深层嵌套列表压到 ≤2 层(Notion 单请求上限)。图片占位不同步。
- 只支持个人库(libraryId=1);macOS;依赖 Zotero + Better BibTeX 开着 + `ntn login`。
