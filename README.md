# ntncite

**Mirror your Zotero library into Notion — cleanly.** A self-hosted, plugin-free alternative to
[Notero](https://github.com/dvanoni/notero), built on Notion's official **`ntn`** CLI.

One row per paper: bibliographic metadata in properties, your reading notes as clean Notion blocks
in the page body — no `Zotero Notes` wrapper, no duplicated dates. Comes with a **macOS menu bar app**
to watch status, trigger syncs, and see history at a glance.

> Built for macOS · Zotero 7 · Better BibTeX. It's my personal setup, shared in case it helps you.

## Why not just Notero?

Notero is great, but: it injects notes into the page as an ugly collapsible `# Zotero Notes` wrapper,
needs an integration token, and you don't control the mapping. `ntncite`:

- **Clean** — one paper = one row; each note is its own block; metadata in real properties.
- **No token** — writes through `ntn` (Notion's official CLI), authenticated as *you*; nothing to paste.
- **Yours** — plain TypeScript; you own the schema and the pipeline.
- **Complete** — syncs metadata *and* notes (replaces Notero entirely).
- **Idempotent + automatic** — dedupes by Zotero item key; runs in the background via launchd.

## How it works

```
Zotero (zotero.sqlite, read-only)        Better BibTeX JSON-RPC (:23119)
   notes + item metadata        ───────►   citekeys
            │
            ▼
   group by paper · HTML → Markdown → Notion blocks (nesting ≤ 2)
            │
            ▼
   upsert into a Notion "Library" DB   (via ntn · dedup by Zotero Item Key · idempotent)
```

Two parts:

| | what | stack |
|---|---|---|
| **`cli/`** | the sync engine — manual or background (launchd) | TypeScript / Node |
| **`menubar/`** | menu bar app: status · one-click sync · health · history · charts | SwiftUI |

## Prerequisites

- **macOS** (uses launchd; the menu bar app is SwiftUI / `MenuBarExtra`).
- **Zotero 7** running, with the **Better BibTeX** plugin (the sync reads citekeys via BBT's
  JSON-RPC on `:23119`, so Zotero must be open).
- **Node 22+** and **pnpm**.
- **`ntn`** — Notion's official CLI — installed and logged in (`ntn api v1/users/me` returns your account).
  This is how it writes to Notion; no integration token needed.

## Setup

```bash
git clone https://github.com/<you>/ntncite && cd ntncite/cli
pnpm install
cp config.example.json config.json          # set zoteroDataDir (default ~/Zotero)
pnpm setup-db <notion-parent-page-id>           # creates the "Library" DB + fills config
pnpm sync --dry-run                          # preview what would sync
pnpm sync                                    # do it
```

`pnpm setup-db` creates a Notion database with the exact schema below under a page you own (pass that
page's ID) and writes its data source id into `config.json`. Prefer to build it by hand? Create a
database with these properties (names must match exactly):

| Property | Type | | Property | Type |
|---|---|---|---|---|
| Name | Title | | Tags | Multi-select |
| Authors | Text | | Zotero URI | URL |
| Year | Number | | Reading Status | Select |
| DOI | Text | | Note Count | Number |
| Publication | Text | | Date Added | Date |
| Citekey | Text | | Content Hash | Text |
| Item Type | Select | | **Zotero Item Key** | Text *(dedup key)* |
| | | | Last Synced | Date |

### Background auto-sync (optional)

```bash
cd cli && sh launchd/install.sh        # every 15 min + on Zotero writes + at login
```

### Menu bar app (optional)

```bash
cd menubar && sh launchd/install.sh    # builds, installs, auto-starts; 📚 appears in the menu bar
# or open menubar/Package.swift in Xcode and Run
```

The app shows last-sync summary, a "currently reading" list of papers (click → open in Notion),
sync history, a duration chart, and health lights (BBT · ntn · volume · Notion). It only drives the
CLI — no sync logic lives in the app.

## Commands

See [`cli/README.md`](cli/README.md). Quick reference:

```bash
pnpm sync --dry-run | --force | --citekey <ck> | --auto
pnpm sync --status | --doctor | --list        # JSON, used by the menu bar app
```

## Limitations

- macOS only; personal library only (`libraryId` 1); Zotero + BBT must be running for a sync.
- Syncs only papers that have notes ("currently reading"). Inline images in notes are not synced
  (placeholder text). Deeply nested lists are flattened to Notion's 2-level request limit.

## License

[MIT](LICENSE)
