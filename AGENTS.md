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
- **Don't touch git.** This is the user's local checkout — don't `commit`, `push`, or `git add` during
  setup. In particular `config.json` is gitignored and holds the user's Notion data-source id; never commit
  it (only `config.example.json` is tracked).
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

If anything above failed, install it before continuing:

- **Node ≥ 22** — `brew install node`, or nvm/fnm. You can do this.
- **pnpm** — `corepack enable` (ships with Node), or `brew install pnpm`. You can do this.
- **`ntn`** (Notion's official CLI) — install per **Notion's official `ntn` instructions** (don't guess a
  package name — check Notion's docs / `brew` / `npm` for the current method, or `ntn --version` to confirm).
  You *can* install it; but **only the user can run `ntn login`** (interactive browser/OAuth). After login,
  `ntn api v1/users/me` must return their account.
- **Better BibTeX** — a **Zotero plugin you cannot install programmatically**. Tell the user: download the
  `.xpi` from the Better BibTeX site, then in Zotero → Tools → Add-ons → gear → *Install Add-on From File*,
  and restart Zotero. Then make sure **Zotero is running** — the sync reads citekeys from BBT's JSON-RPC on
  `:23119`.

## Setup

If you were pointed at an **already-cloned** checkout, skip `git clone` and just `cd cli`.

```bash
git clone https://github.com/BrooksC02/ntncite && cd ntncite/cli   # skip clone if already in the repo
pnpm install                              # builds/downloads a native module (better-sqlite3);
                                          #   the "Ignored build scripts: esbuild" warning is harmless
cp config.example.json config.json
#  → edit config.json: set "zoteroDataDir" to the user's Zotero data dir.
#    Default is ~/Zotero; ASK the user if theirs is elsewhere (e.g. an external volume).
pnpm setup-db <notion-parent-page-id>   # ASK the user for this; creates the DB + writes its id into config.json
pnpm sync --dry-run                      # show the user the plan
#  → get the user's OK, THEN:
pnpm sync
```

`pnpm setup-db` accepts a pasted Notion page URL or a raw 32-hex id. No "integration connect" is needed —
`ntn` writes as the user, so their own access is enough (the page just has to be one they can edit).

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

## Updating later

```bash
cd ntncite && git pull && cd cli && pnpm install
# if the user installed them, re-run the install scripts to pick up changes:
sh launchd/install.sh                    # auto-sync agent
cd ../menubar && sh launchd/install.sh   # menu-bar app
```

## Uninstalling / backing out

```bash
cd ntncite/cli && sh launchd/uninstall.sh     # remove the auto-sync agent (if installed)
cd ../menubar && sh launchd/uninstall.sh      # remove the menu-bar app (if installed)
```

- Delete `cli/config.json` to drop the local data-source id.
- The Notion "Library" DB is **not** auto-deleted — the user removes it by hand in Notion if they want it gone.

## Read for context

- `README.md` — overview, the Notion **schema table**, **Sync semantics** (what's safe to edit, conflicts), Limitations.
- `SECURITY.md` — trust model (ntn authenticates as the user; what `config.json` does and doesn't hold).
- `cli/README.md` — full command/flag reference.
