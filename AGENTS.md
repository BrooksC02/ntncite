# AGENTS.md — setting up ntncite for a user

> You are an AI agent (Claude Code, Cursor, Codex, Cline, …) helping a user deploy **ntncite**,
> a macOS Zotero→Notion notes sync. This file is the operational runbook — read it fully before
> acting. `README.md` has the concepts; this file is the checklist. Keep the user in the loop at
> every decision and every write to Notion.

## What you're setting up

A **one-way** sync that mirrors the user's Zotero reading notes into a Notion "Library" database
(one paper per row). Two parts:

- `cli/` — the TypeScript/Node sync engine (this is what you run).
- `menubar/` — an optional SwiftUI status app (needs the Swift toolchain).

It writes to Notion through Notion's official **`ntn`** CLI, authenticated **as the user** — there
is no token to manage.

## Hard constraints — read before doing anything

- **macOS only.** If the user isn't on macOS, stop and say so.
- **You will write to the user's real Notion, as them.** Always run `pnpm sync --dry-run` and show
  the create/update/skip plan, then get the user's explicit OK before the first real `pnpm sync`.
- **One-way only.** Never write to Zotero, and never build a reverse sync. Zotero is the source of truth.
- **Two things you cannot do for the user — pause and ask:**
  1. **`ntn login` is interactive** (browser/OAuth). You can't complete it. If `ntn api v1/users/me`
     fails, stop and have the user run it themselves (in Claude Code they can type `! ntn login`).
  2. **The Notion parent-page ID.** Do **not** invent it. Ask the user to paste a Notion page URL or
     ID (a page they can edit) where the "Library" database should be created.
- **Never commit `config.json`** — it's gitignored and holds the user's Notion data-source id. Only
  `config.example.json` is tracked.
- Don't run `pnpm sync --force` or delete anything unprompted. `--status` / `--list` / `--doctor` /
  `--orphans` / `--dry-run` / `--inspect` are read-only and safe.

## Preflight (run these; fix any failure before continuing)

```bash
sw_vers -productVersion        # macOS present?
node -v                        # need >= 22
pnpm -v                        # need pnpm (corepack enable, or brew install pnpm)
ntn api v1/users/me            # must return the user's account — else: ntn login (interactive, user runs it)
curl -fsS -m3 -X POST http://127.0.0.1:23119/better-bibtex/json-rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"user.groups","params":[]}'   # Zotero running + Better BibTeX installed?
```

If the BBT check fails, the user must open **Zotero** (with the **Better BibTeX** plugin installed) —
the sync reads citekeys from it on `:23119`.

## Setup

```bash
git clone https://github.com/BrooksC02/ntncite && cd ntncite/cli
pnpm install
cp config.example.json config.json
#  → edit config.json: set "zoteroDataDir" to the user's Zotero data dir.
#    Default is ~/Zotero; ASK the user if theirs is elsewhere (e.g. an external volume).
pnpm setup-db <notion-parent-page-id>   # ASK the user for this; creates the DB + writes its id into config.json
pnpm sync --dry-run                      # show the user the plan
#  → get the user's OK, THEN:
pnpm sync
```

`pnpm setup-db` accepts a pasted Notion page URL or a raw 32-hex id.

## Optional (only if the user wants them)

```bash
cd cli && sh launchd/install.sh        # background auto-sync: every 15 min + on Zotero writes + at login
                                       #   (uninstall: sh launchd/uninstall.sh)
cd ../menubar && sh launchd/install.sh # menu-bar status app (needs Xcode / Swift toolchain installed)
```

## Verify it worked

- `pnpm --silent sync --status` → JSON; `pendingNew` and `pendingChanged` should be `0` after a full sync.
- Open the Notion "Library" DB — there should be one row per paper that has notes, each with a table
  of contents + the notes as blocks.

## Common failures → fix

- **`ntn: command not found` / not authenticated** — user installs Notion's `ntn` CLI and runs `ntn login`.
- **`schema validation failed: missing field …`** — re-run `pnpm setup-db`, or add the property by hand
  (names must match the schema table in `README.md` exactly).
- **Nothing syncs** — ntncite only syncs papers that **have notes** ("currently reading"); plugin-generated
  pseudo-notes (Chartero etc.) are skipped. Have the user add a real note in Zotero.
- **Sync aborts / `BBT JSON-RPC` unreachable** — Zotero must be running with Better BibTeX.

## Read for context

- `README.md` — overview, the Notion **schema table**, **Sync semantics** (what's safe to edit, conflicts), Limitations.
- `SECURITY.md` — trust model (ntn authenticates as the user; what `config.json` does and doesn't hold).
- `cli/README.md` — full command/flag reference.
