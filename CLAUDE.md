# gog MCP Server

## IMPORTANT — Prefer gog over docx-js for Google Docs

When asked to create or format a Google Doc, **always use gog MCP tools** — never generate a .docx file with docx-js and upload it. gog has full rich formatting capabilities:

- **`docs_sed`** — the primary formatting tool. Uses SEDMAT brace syntax to apply any combination of: bold, italic, underline, strikethrough, small caps, fonts, sizes, colors, headings (H1-H6), alignment, spacing, indentation, lists (bulleted/numbered), tables, page breaks, section breaks, columns, checkboxes, links, images, and more — all in a single call.
- **`docs_update`** / **`docs_format`** — simpler tools for basic formatting (font, color, alignment) by flag.
- **`docs_find_replace`** with `format=markdown` — for inserting rich content including inline images.

The result is a **native Google Doc** (collaborative, shareable, editable in Google Docs UI) — not an uploaded Word file. Only use docx-js when the user explicitly requests a `.docx` Word file.

### docs_sed quick reference

```
s/find/replace{flags}/g          — find and replace with formatting
d/pattern/                        — delete matching lines
3s/old/new/                       — address specific line

Brace flags:
  {b} bold  {i} italic  {_} underline  {~} strike  {sc} small caps
  {^} superscript  {v} subscript
  {f=Arial} font  {s=14} size  {c=#FF0000} color  {z=#FFFF00} bg
  {h=1} heading 1-6  {a=center} align  {p=12,6} spacing  {l=1.5} leading
  {n=2} indent  {cols=2} columns  {check} checkbox
  {+=p} page break  {+=s} section break
  {0} reset formatting  {!0} additive mode
  [text](url) link  ![alt](url){x=200,y=150} image
  T=3x4 create table  |1| target table 1
  - bullet  1. numbered list

Combine: {b,i,f=Georgia,s=18,c=#333333,a=center}
```

## Architecture

- **gog-mcp** (`~/Projects/gog/`) — TypeScript MCP server that shells out to the `gog` CLI
  - Entry: `src/index.ts` → 40 MCP tools (Gmail, Calendar, Drive, Docs, Docs Sed, Docs Insert/Find-Replace, Docs Comments, Sheets, Contacts)
  - Build: TypeScript → `dist/index.js`
  - Launcher: `run.sh` (injects 1Password secrets, sets `GOG_PATH`, exec's node)

- **gogcli** (`~/Projects/gogcli/`) — Go CLI (upstream: `steipete/gogcli`, MIT license)
  - Cloned and built from source at v0.12.0 (forked from `steipete/gogcli`), with local modifications
  - Binary: `~/Projects/gogcli/gog`
  - `run.sh` sets `GOG_PATH` to point here instead of the Homebrew binary
  - Key files:
    - `internal/cmd/docs_formatter.go` — formatting helpers: `parseHexColor`, `FormattingOpts`, `buildFormattingRequests`
    - `internal/cmd/docs.go` — docs commands incl. `DocsUpdateCmd` (with formatting flags), `DocsFormatCmd` (--match text targeting)
    - `internal/cmd/docs_markdown.go` — markdown parser, `TextStyle`, `utf16Len`
    - `internal/cmd/docs_edit.go` — insert, find-replace, and edit commands (with image markdown support)
    - `internal/cmd/docs_comments.go` — comment CRUD (add, list, delete, reply, resolve)
    - `internal/googleapi/docs.go` — Docs API client wrapper

## Local gogcli Modifications (on top of v0.12.0)

- **`docs update` command**: Added formatting flags: `--font-family`, `--font-size`, `--text-color`, `--bg-color`, `--alignment`, `--underline`, `--strikethrough`, `--line-spacing`. Applied via second `batchUpdate` after content insertion.
- **`docs format` command** (new): Applies formatting to existing text. Supports `--match "text"` to target by content, `--match-all` for all occurrences, or `--start-index`/`--end-index` for explicit ranges. Same formatting flags as `docs update` plus `--bold` and `--italic`.
- **`docs_formatter.go`**: Added `FormattingOpts` struct, `parseHexColor()`, `buildFormattingRequests()` for building `UpdateTextStyle`/`UpdateParagraphStyle` API requests.

## MCP Tools Added

- **`drive_rename`** — rename a file/folder in Google Drive
- **`drive_delete`** — trash (or permanently delete) a file. Uses `--force` for non-interactive mode.
- **`drive_move`** — move a file to a different folder
- **`drive_share`** — share a file/folder (supports `anyone`, `user`, `domain` targets). Uses `--force` for non-interactive. Required for image insertion workflow.
- **`docs_update`** — insert/replace content with optional formatting (font, color, alignment, etc.)
- **`docs_format`** — apply formatting to existing text by matching content or whole document
- **`docs_insert`** — insert plain text at a specific position in a doc (no image support; use `docs_find_replace` for images)
- **`docs_find_replace`** — find and replace text; with `--format markdown`, supports rich replacements including inline images via `![alt](https://url)` syntax (remote URLs only)
- **`docs_sed`** — powerful sed-like formatting engine (SEDMAT syntax): regex find/replace, rich text formatting ({b,i,f=Arial,s=14,c=#FF0000}), headings, lists, tables, page breaks, columns, checkboxes, images, and more — all in a single command
- **`docs_comments_list`** — list comments on a Google Doc (with optional `--show-anchors` for kix ID discovery)
- **`docs_comments_get`** — get a specific comment by ID
- **`docs_comments_add`** — add a comment to a Google Doc (doc-level only; anchoring not supported by API)
- **`docs_comments_reply`** — reply to a comment
- **`docs_comments_resolve`** — resolve a comment (mark as done)
- **`docs_comments_delete`** — delete a comment

## Image Insertion Workflow (for LLMs)

To insert an image into an existing Google Doc, LLMs must follow this pipeline:

1. **Save/download** the image to a local temp file (e.g., `/tmp/image.png`)
2. **`drive_upload`** the file → returns `webContentLink` (direct download URL)
3. **`drive_share`** the file with `to=anyone, role=reader` → makes it fetchable by Google
4. **`docs_find_replace`** with `format=markdown` → replace a placeholder with `![alt](webContentLink)`

**Key constraints:**
- The Docs API `InsertInlineImage` requires a URI that Google's servers can fetch — raw bytes are not supported
- `webContentLink` (not `webViewLink`) is the correct URL format
- `docs_insert` does NOT support images — it inserts plain text only
- Local file paths in image markdown only work if the file is on the executing machine's filesystem

**Validated:** This pipeline was tested end-to-end (upload → share → find-replace → confirmed InlineObject in doc).

## Google Docs Comment Anchoring — Confirmed Limitation

**There is NO programmatic way to create anchored comments in Google Docs.**

- The Drive API `quotedFileContent` field alone does NOT anchor comments — shows "Original content deleted"
- The `anchor` field with `kix.*` element IDs is the only format that works for inline highlighting
- `kix.*` IDs are internal to Google's Kix editor engine and never exposed by any API (Docs or Drive)
- The `txt` offset format (`{"r":"head","a":[{"txt":{"o":5,"l":10}}]}`) is accepted but ignored by the editor UI
- Apps Script `DocumentApp` has no comment API
- Open Google bugs: [#36763384](https://issuetracker.google.com/issues/36763384), [#357985444](https://issuetracker.google.com/issues/357985444)
- See also: [googleworkspace/cli#169](https://github.com/googleworkspace/cli/issues/169)

**Only workaround:** Read back kix IDs from UI-created comments via `comments.list`, then reuse them for new comments at the same position.

## VPS Deployment

The gog MCP server can be deployed to a Linux VPS (`root@<YOUR_VPS_IP>`) for use by server-side AI agents.

### What's deployed

| VPS Path | Contents | Source |
|----------|----------|--------|
| `/usr/local/bin/gog` | gogcli binary (linux/amd64, static, v0.12.0-dev) | Cross-compiled from `~/Projects/gogcli/` with `GOOS=linux GOARCH=amd64 CGO_ENABLED=0` |
| `/root/gog-mcp/` | gog-mcp Node.js server (dist + node_modules) | Packaged from `~/Projects/gog/` |
| `/root/.config/gogcli/` | OAuth credentials + encrypted keyring | Set up via `setup-gog.sh` from 1Password |

### How it's registered

Gateway / orchestrator config (adapt to your setup — Claude Desktop, an MCP gateway, a process manager, etc.) `mcp.servers.gog`:
```json
{
  "command": "node",
  "args": ["/home/node/gog-mcp/dist/index.js"],
  "env": {
    "GOG_PATH": "/usr/local/bin/gog",
    "GOG_ACCOUNT": "<your-google-account>",
    "GOG_KEYRING_PASSWORD": "${GOG_KEYRING_PASSWORD}"
  }
}
```

Docker mounts in `docker-compose.override.yml`:
- `/root/gog-mcp:/home/node/gog-mcp:ro`
- `/usr/local/bin/gog:/usr/local/bin/gog:ro`
- `/root/.config/gogcli:/home/node/.config/gogcli:ro`

### Redeployment

After making changes to gog-mcp or gogcli:
```bash
# 1. Cross-compile gogcli
cd ~/Projects/gogcli && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o gog-linux-amd64 ./cmd/gog/

# 2. Package gog-mcp
cd ~/Projects/gog && tar czf /tmp/gog-mcp.tar.gz dist/ node_modules/ package.json

# 3. Upload
scp ~/Projects/gogcli/gog-linux-amd64 root@<YOUR_VPS_IP>:/usr/local/bin/gog
scp /tmp/gog-mcp.tar.gz root@<YOUR_VPS_IP>:/root/
ssh root@<YOUR_VPS_IP> 'tar xzf /root/gog-mcp.tar.gz -C /root/gog-mcp/ && chmod +x /usr/local/bin/gog'

# 4. Restart gateway
ssh root@<YOUR_VPS_IP> 'systemctl restart your-mcp-gateway'   # or docker compose restart, etc.
```
