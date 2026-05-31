# Security & trust model

ntncite is a personal, self-hosted tool. It runs entirely on your machine and talks to
two local things (Zotero's SQLite DB, Better BibTeX's JSON-RPC) and one CLI (`ntn`).
There is no server and no telemetry.

## What holds credentials

- **`ntn` (Notion's official CLI) holds the only credential.** ntncite never stores a
  Notion token. It shells out to `ntn`, which authenticates **as you** via `ntn login`
  (its own local credential cache). ntncite writes to Notion with whatever access your
  `ntn` session has.
- **`config.json` holds no secrets** — only your Zotero data-dir path and the target
  Notion data-source id. It is gitignored; only `config.example.json` (placeholders) is
  committed. Even so, treat it as local-only.
- **Zotero is read-only.** The SQLite DB is copied to a temp dir and opened read-only;
  ntncite never writes to your Zotero library.

## Trust placed in `ntn`

`ntn` is resolved from your `PATH` and executed with your full Notion access. Install it
from Notion's official source and make sure the `ntn` on your `PATH` is the one you
expect — ntncite drives whatever binary resolves first. (ntncite invokes it via
`execFile` with an argument array, so note titles/contents cannot inject shell commands.)

## Dependencies

- The Node deps are all permissive-licensed (MIT/ISC/BSD/Apache).
- The Markdown→Notion pipeline (`@tryfabric/martian`) pulls in a 2020-era
  unified/micromark stack. `katex` is pinned to a patched line via a pnpm `override`;
  `pnpm audit --prod` reports no known vulnerabilities. Re-run `pnpm audit` after
  changing dependencies.
- `better-sqlite3` compiles/downloads a native binary at install time. Use
  `pnpm install --frozen-lockfile` (as CI does) for a reproducible, lockfile-pinned install.

## Reporting

This is a personal project shared as-is. If you spot a security issue, please open a
GitHub issue (or a private advisory) on the repository.
