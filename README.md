# ntncite

![platform](https://img.shields.io/badge/platform-macOS-black)
![license](https://img.shields.io/badge/license-MIT-blue)
![Notion](https://img.shields.io/badge/Notion-via%20ntn-000)

**English** · [中文](README.zh-CN.md)

**Mirror your Zotero library into Notion — cleanly.** A self-hosted, plugin-free sync built on
Notion's official **`ntn`** CLI — inspired by [Notero](https://github.com/dvanoni/notero).

One row per paper: bibliographic metadata in properties, your reading notes as clean Notion blocks
in the page body — no `Zotero Notes` wrapper, no duplicated dates, with a table of contents up top.
It mirrors the papers you're **actively reading** (the ones you've annotated), newest-updated first.
Comes with a **macOS menu bar app** to watch status, trigger syncs, and see history at a glance.

> Built for macOS · Zotero + Better BibTeX. It's my personal setup, shared in case it helps you.

## Screenshots

<p align="center">
  <img src="docs/menubar.png" alt="ntncite menu bar app" width="380">
</p>

> Screenshot uses **demo data** (well-known public papers). Preview the UI yourself with no setup:
> `cd menubar && swift build && NTNCITE_DEMO=1 .build/debug/Ntncite` — then press **⌃⌥⌘E** to pop it open.
> The 🌐 button toggles English / 中文.

## What it looks like in Notion

Each paper becomes **one row** in a Notion "Library" database. Open a row and you get:

- **Properties** — title, authors, year, DOI, publication, citekey, item type, tags, Zotero URI, reading status, note count, date added.
- **A table of contents**, then **your notes as clean blocks** — each note its own section, in the order you wrote them. No wrapper, no duplicated dates, no plugin cruft.

Rows are ordered **most-recently-updated first**, so whatever you're reading floats to the top. Editing the **Reading Status** by hand is safe — the sync won't overwrite it (Zotero is the source of truth for everything else).

<p align="center">
  <img src="docs/zotero-notes.png" alt="reading notes in Zotero" width="440"><br>
  <sub><i>your Zotero notes …</i></sub>
</p>
<p align="center">
  <img src="docs/notion-page.png" alt="the synced paper page in Notion" width="440"><br>
  <sub><i>… become one clean Notion page: properties + a table of contents + notes as blocks</i></sub>
</p>

## Background

`ntncite` grew out of two things: the inspiration of [Notero](https://github.com/dvanoni/notero)
— the idea of mirroring your Zotero reading into Notion — and the release of Notion's official
**`ntn`** CLI, which made it possible to write to Notion **as yourself, with no integration token**.
That combination let me build the version I wanted:

- **Clean** — one paper = one row; each note is its own block; metadata in real properties (no injected wrapper).
- **No token** — writes through `ntn`, authenticated as *you*; nothing to paste or rotate.
- **Yours** — plain TypeScript; you own the schema and the pipeline.
- **Complete** — syncs both metadata *and* notes.
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
| **`menubar/`** | menu bar app: status · one-click sync · health · history | SwiftUI |

## Prerequisites

- **macOS** (Apple Silicon or Intel; uses launchd, and the menu bar app is SwiftUI / `MenuBarExtra`).
- **Zotero** running (tested on 9.x), with the **Better BibTeX** plugin (the sync reads citekeys via
  BBT's JSON-RPC on `:23119`, so Zotero must be open).
- **Node 22+** and **pnpm**.
- **`ntn`** — Notion's official CLI — installed and logged in (`ntn api v1/users/me` returns your account).
  This is how it writes to Notion; no integration token needed.

## Setup

```bash
git clone https://github.com/BrooksC02/ntncite && cd ntncite/cli
pnpm install
cp config.example.json config.json          # set zoteroDataDir (default ~/Zotero)
pnpm setup-db <notion-parent-page-id>        # creates the "Library" DB + fills config
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

Of these, only **Reading Status** is yours to edit — the sync never overwrites it. Everything else is rewritten from Zotero on each sync; `Content Hash` / `Zotero Item Key` / `Last Synced` are the sync's own bookkeeping (don't hand-edit them).

### Background auto-sync (optional)

```bash
cd cli && sh launchd/install.sh        # every 15 min + on Zotero writes + at login
sh launchd/uninstall.sh                # remove the agent
```

### Menu bar app (optional)

```bash
cd menubar && sh launchd/install.sh    # builds, installs, auto-starts; 📚 appears in the menu bar
# or open menubar/Package.swift in Xcode and Run
```

The app shows:

- **Status + what's pending** — last-sync summary and a `N new · M changed` count.
- **Currently-reading list** — each paper carries a state dot (new / changed / synced) and an image-not-synced badge; click → open it in Notion.
- **History** — per-run create/update/skip + duration, and **which papers failed** (and why).
- **Stale tab** — an on-demand check for Notion pages no longer backed by Zotero (click → open to delete by hand).
- **Health lights** — BBT · ntn · volume · Notion.

It only drives the CLI — no sync logic lives in the app.

## Commands

See [`cli/README.md`](cli/README.md). Quick reference:

```bash
pnpm sync --dry-run | --force | --citekey <ck> | --auto
pnpm sync --status | --doctor | --list | --orphans   # JSON, used by the menu bar app
```

## Sync semantics

One-way only: **Zotero is the source of truth, Notion is a mirror.** The tool reads Zotero
read-only and never writes back. Each paper is matched by its Zotero item key, and a content
hash decides whether a page is created, skipped (unchanged), or updated. An `update`
re-renders the whole page body from the note's *current* Zotero content.

What that means in practice:

- **Editing a Notion page body is not durable.** The next `update` of that paper re-renders
  the body from Zotero and overwrites your changes — same for metadata properties (Authors,
  Tags, …). The **one exception is `Reading Status`**: the sync never overwrites it, so that
  field is yours to manage in Notion.
- **Editing or deleting a Zotero note propagates.** Edit a note → the next sync updates the
  page. Delete one note of a multi-note paper → that section disappears on the next sync.
- **Deleting a paper's last note (or the whole item) does NOT delete the Notion page.** The
  paper just stops being synced and its page is left behind (stale) — remove it by hand in
  Notion if you want it gone.
- **Conflicts resolve to Zotero, no merge.** If a paper's Zotero note changed, `update`
  overwrites the Notion body (edits there are lost). If only Notion changed, the page is
  skipped and your edit survives — but only until you next touch that Zotero note.

Rule of thumb: treat the page **body** as read-only. Keep your own notes in Zotero, and use
`Reading Status` (or a separate, un-synced page) for anything you want to own in Notion.

## Limitations

- macOS only; personal library only (`libraryId` 1); Zotero + BBT must be running for a sync.
- Syncs only papers that have notes ("currently reading"). Inline images in notes are not synced
  (placeholder text). Deeply nested lists are flattened to Notion's 2-level request limit.
- Plugin-generated pseudo-notes are skipped (Chartero reading-history, addon storage, "Do not modify" placeholders) — only your real, hand-written notes sync.

## Troubleshooting

- **`ntn: command not found` / not authenticated** — install Notion's `ntn` CLI and run `ntn login`; `ntn api v1/users/me` should return your account.
- **Nothing syncs** — only papers that have a **note** are synced (that's "currently reading"). Add a note in Zotero first.
- **Sync aborts / `BBT JSON-RPC` unreachable** — Zotero must be **running** with Better BibTeX (it serves citekeys on `:23119`). Open Zotero and retry.
- **`schema validation failed: missing field …`** — your Notion DB is missing a property. Re-run `pnpm setup-db`, or add the property by hand (names must match the schema table above exactly).
- **Wrong Zotero library** — set `zoteroDataDir` in `config.json` (default `~/Zotero`); the DB is `zotero.sqlite` under it.
- **Re-push everything** — `pnpm sync --force` rewrites all rows (after changing the mapping, or to backfill the table of contents on older pages).

## Security

`ntncite` stores no Notion token — it writes through `ntn`, authenticated as *you*. See **[SECURITY.md](SECURITY.md)** for the trust model and dependency notes.

## Contributing

A personal project, shared as-is — but issues and PRs are welcome.

## License

[MIT](LICENSE)
