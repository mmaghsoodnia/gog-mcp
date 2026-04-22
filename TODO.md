# TODO

## Done (2026-03-26)
- [x] Add rich formatting to Google Docs via gogcli + MCP
  - [x] Added `FormattingOpts`, `parseHexColor()`, `buildFormattingRequests()` to `docs_formatter.go`
  - [x] Extended `docs update` with formatting flags (font, color, alignment, underline, etc.)
  - [x] Added `docs format` subcommand with `--match` text targeting
  - [x] Added `docs_update` and `docs_format` MCP tools
  - [x] Fixed kong enum bug (alignment field needed no enum tag)
- [x] Add Drive MCP tools: `drive_rename`, `drive_delete` (with --force), `drive_move`

## Done (2026-03-23)
- [x] Clone steipete/gogcli to ~/Projects/gogcli/ at v0.11.0
- [x] Security audit — clean, no red flags
- [x] Install Go 1.26.1 via Homebrew
- [x] Build gogcli from source
- [x] Update run.sh to use source-built binary via GOG_PATH
- [x] Verify MCP server works with source-built binary
- [x] Research comment anchoring — confirmed as Google API limitation (not fixable)

## Done (2026-03-27)
- [x] Deploy gog MCP server to Linux VPS
  - [x] Cross-compiled gogcli for linux/amd64 (static, CGO_ENABLED=0)
  - [x] Packaged gog-mcp (dist + node_modules) and uploaded to VPS
  - [x] Updated docker-compose.override.yml with gog-mcp volume mount
  - [x] Registered `mcp.servers.gog` in gateway config
  - [x] Verified binary and MCP server work inside Docker container
  - [x] Documented in CLAUDE.md

## Done (2026-03-29)
- [x] Add MCP tools for docs comments (list, get, add, reply, resolve, delete) — 6 new tools in src/index.ts (30→36 total)
- [x] Improve --quoted and --anchor help text in gogcli with anchoring limitation note
- [x] Add --show-anchors flag to docs comments list for kix ID discovery
- [x] Fix stale version references — gogcli is v0.12.0+local, not v0.11.0

## Done (2026-04-11)
- [x] Add `docs_sed` MCP tool — exposes gogcli's full SEDMAT formatting engine (regex, rich formatting, tables, lists, headings, page breaks, columns, checkboxes, images)
- [x] Deployed to VPS and verified
- [x] Added "prefer gog over docx-js" directive to global CLAUDE.md and project CLAUDE.md with SEDMAT quick reference
- [x] Saved feedback memory to prevent future docx-js fallback

## Done (2026-04-08)
- [x] Add `drive_share` MCP tool — share files with anyone/user/domain (uses `--force` for non-interactive)
- [x] Add `webContentLink` to `drive upload` JSON output (gogcli change) — needed for image insertion
- [x] Validated full image insertion pipeline: upload → share → find-replace markdown → confirmed InlineObject in doc
- [x] Documented image insertion workflow in CLAUDE.md

## Done (2026-04-07)
- [x] Add `docs_insert` MCP tool — insert plain text at a specific position
- [x] Add `docs_find_replace` MCP tool — find and replace with plain or markdown format (images via remote URLs only)
- [x] Fixed misleading image support claims in `docs_insert` (underlying CLI only does `InsertText`)
- [x] Updated CLAUDE.md: tool count 36→39, added docs_edit.go key file, corrected tool descriptions

## Pending
- [ ] Upstream the formatting changes to steipete/gogcli via PR (or maintain as local fork)
- [x] ~~Redeploy updated gogcli binary and gog-mcp to VPS~~ (done 2026-04-11, includes drive_share + image pipeline + docs_sed)
