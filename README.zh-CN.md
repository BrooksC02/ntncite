# ntncite

![platform](https://img.shields.io/badge/platform-macOS-black)
![license](https://img.shields.io/badge/license-MIT-blue)
![Notion](https://img.shields.io/badge/Notion-via%20ntn-000)

[English](README.md) · **中文**

**把你的 Zotero 文献库干净地镜像进 Notion。** 一个自托管、无插件的同步工具,基于 Notion 官方的
**`ntn`** CLI —— 灵感来自 [Notero](https://github.com/dvanoni/notero)。

**一篇论文一行**:题录元数据放属性,你写的读书笔记作为干净的 Notion block 进页面正文 —— 没有
`Zotero Notes` 外壳、没有重复日期,正文最前面还带一个目录。同步的是你**正在读**的论文(标过笔记的那些),
最近更新的排在最前。还附带一个 **macOS 菜单栏 App**,一眼看同步状态、手动触发、查历史。

> 为 macOS · Zotero + Better BibTeX 而做。这是我个人的工作流,分享出来万一对你有用。

## 截图

<p align="center">
  <img src="docs/menubar.png" alt="ntncite 菜单栏 App" width="380">
</p>

> 截图用的是 **demo 数据**(著名公开论文)。零配置预览界面:
> `cd menubar && swift build && NTNCITE_DEMO=1 .build/debug/Ntncite`,然后按 ⌃⌥⌘E 在状态栏展开。
> 右下角 🌐 切换 English / 中文。

## 在 Notion 里长什么样

每篇论文 = Notion「Library」库里的**一行**。点开一行:

- **属性** —— 标题、作者、年份、DOI、期刊、citekey、条目类型、标签、Zotero URI、阅读状态、笔记数、加入日期。
- **一个目录**,然后是**你的笔记各自成块** —— 每条笔记单独成段,按你写的顺序排。没有外壳、没有重复日期、没有插件垃圾。

行按**最近更新优先**排序,正在读的自然浮到最上面。手改**阅读状态**是安全的 —— 同步不会覆盖它(其余字段以 Zotero 为准)。

## 缘起

`ntncite` 来自两件事:[Notero](https://github.com/dvanoni/notero) 的启发(把 Zotero 阅读
镜像进 Notion 这个点子),以及 Notion 官方 **`ntn`** CLI 的发布 —— 后者让"**以你本人身份、无需
integration token** 写 Notion"成为可能。这个组合让我能做出想要的版本:

- **干净** —— 一篇论文一行;每条笔记各自成块;元数据进真实属性(无注入外壳)。
- **免 token** —— 经 `ntn` 写入,以你本人身份认证;不用粘贴/轮换任何密钥。
- **自持** —— 纯 TypeScript;schema 和管道都归你。
- **完整** —— 题录 + 笔记一起同步。
- **幂等 + 自动** —— 按 Zotero item key 去重;经 launchd 后台运行。

## 工作原理

```
Zotero (zotero.sqlite, 只读)            Better BibTeX JSON-RPC (:23119)
   笔记 + 题录元数据          ───────►   citekey
            │
            ▼
   按论文分组 · HTML → Markdown → Notion blocks(嵌套 ≤ 2 层)
            │
            ▼
   upsert 到 Notion「Library」库   (经 ntn · 按 Zotero Item Key 去重 · 幂等)
```

两部分:

| | 是什么 | 技术栈 |
|---|---|---|
| **`cli/`** | 同步引擎 —— 手动或后台(launchd) | TypeScript / Node |
| **`menubar/`** | 菜单栏 App:状态 · 一键同步 · 健康灯 · 历史 | SwiftUI |

## 前置条件

- **macOS**(Apple Silicon 或 Intel;用 launchd,菜单栏 App 是 SwiftUI / `MenuBarExtra`)。
- **Zotero** 开着(在 9.x 上测过)+ **Better BibTeX** 插件(同步靠 BBT 的 JSON-RPC :23119 解析
  citekey,所以 Zotero 必须开着)。
- **Node 22+** 和 **pnpm**。
- **`ntn`**(Notion 官方 CLI)已安装并登录(`ntn api v1/users/me` 能返回你的账号)。写 Notion 靠它,
  不需要 integration token。

## 安装

```bash
git clone https://github.com/BrooksC02/ntncite && cd ntncite/cli
pnpm install
cp config.example.json config.json          # 填 zoteroDataDir(默认 ~/Zotero)
pnpm setup-db <notion-父页面-id>             # 自动建「Library」库 + 回填 config
pnpm sync --dry-run                          # 预览将同步什么
pnpm sync                                    # 真同步
```

`pnpm setup-db` 会在你拥有的某个页面下(传它的 ID)创建一个符合下面 schema 的 Notion 数据库,
并把它的 data source id 写进 `config.json`。想手动建库?创建一个含下列属性的数据库(名字必须完全一致):

| 属性 | 类型 | | 属性 | 类型 |
|---|---|---|---|---|
| Name | Title | | Tags | Multi-select |
| Authors | Text | | Zotero URI | URL |
| Year | Number | | Reading Status | Select |
| DOI | Text | | Note Count | Number |
| Publication | Text | | Date Added | Date |
| Citekey | Text | | Content Hash | Text |
| Item Type | Select | | **Zotero Item Key** | Text *(去重主键)* |
| | | | Last Synced | Date |

### 后台自动同步(可选)

```bash
cd cli && sh launchd/install.sh        # 每 15 分钟 + Zotero 写库时触发 + 登录自启
sh launchd/uninstall.sh                # 卸载这个 agent
```

### 菜单栏 App(可选)

```bash
cd menubar && sh launchd/install.sh    # 编译、安装、自启;菜单栏出现 📚
# 或用 Xcode 打开 menubar/Package.swift 然后 Run
```

App 显示上次同步摘要、"在读"论文列表(点击 → 在 Notion 打开)、同步历史,以及健康灯
(BBT · ntn · 卷 · Notion)。它只驱动 CLI —— 同步逻辑不在 App 里。

## 命令

详见 [`cli/README.md`](cli/README.md)。速查:

```bash
pnpm sync --dry-run | --force | --citekey <ck> | --auto
pnpm sync --status | --doctor | --list        # JSON,菜单栏 App 用
```

## 限制

- 仅 macOS;仅个人库(`libraryId` 1);同步时 Zotero + BBT 必须开着。
- 只同步**有笔记的论文**(= 在读)。笔记里的内嵌图片不同步(占位文本)。深层嵌套列表会被压到
  Notion 单请求的 2 层上限。

## 排错

- **`ntn: command not found` / 没登录** —— 装上 Notion 的 `ntn` CLI 并 `ntn login`;`ntn api v1/users/me` 能返回你的账号即可。
- **什么都没同步** —— 只同步**有笔记**的论文(即「在读」)。先在 Zotero 里给它写条笔记。
- **同步中止 / 连不上 `BBT JSON-RPC`** —— Zotero 必须**开着**且装了 Better BibTeX(它在 `:23119` 提供 citekey)。开 Zotero 再试。
- **`schema validation failed: missing field …`** —— Notion 库缺了某个属性。重跑 `pnpm setup-db`,或手动补上(名字要跟上面 schema 表**完全一致**)。
- **Zotero 库不对** —— 在 `config.json` 里设 `zoteroDataDir`(默认 `~/Zotero`),库文件是其下的 `zotero.sqlite`。
- **全部重推** —— `pnpm sync --force` 重写所有行(改了映射后,或给旧页面补目录时用)。

## 安全

`ntncite` 不存任何 Notion token —— 写入走 `ntn`,以**你本人**身份认证。信任模型和依赖说明见 **[SECURITY.md](SECURITY.md)**。

## 贡献

个人项目,原样分享 —— 但欢迎 issue 和 PR。

## 许可

[MIT](LICENSE)
