# gog-mcp

MCP (Model Context Protocol) server that wraps [gogcli](https://github.com/steipete/gogcli) to give AI tools (Claude Code, Claude Desktop, Cursor, etc.) access to Google Workspace — Gmail, Calendar, Drive, Docs, Sheets, and Contacts.

## How it works

A single TypeScript file (`src/index.ts`) exposes 40 MCP tools. Each tool shells out to the `gog` CLI with the appropriate subcommand and flags. The server communicates over stdio using the MCP SDK.

All secrets live in 1Password. The `gog.config` file tells the scripts which vault and account to use — it is gitignored and never committed.

---

## Quick Setup (new machine)

### 1. Prerequisites

- **Node.js 22+** — `brew install node@22 && brew link node@22`
- **gog CLI** — see [gogcli binary](#gogcli-binary) below
- **1Password CLI** (`op`) — `brew install 1password-cli`
- **1Password service account token** at `~/.op-service-account-token` (read-only, for automated secret injection)

### 2. Clone and build

```bash
git clone git@github.com:mmaghsoodnia/gog-mcp.git ~/Projects/gog
cd ~/Projects/gog
./setup.sh
```

### 3. Configure

```bash
cp gog.config.example gog.config
```

Edit `gog.config` and fill in:
- `OP_VAULT` — your 1Password vault name
- `OP_ACCOUNT` — your 1Password account (e.g. `my.1password.com`)
- `GOG_ACCOUNT` — the Google account this deployment acts as

### 4. Pull credentials from 1Password

```bash
./setup-from-op.sh
```

This writes OAuth credentials and tokens from 1Password to `~/Library/Application Support/gogcli/` (macOS) or `~/.config/gogcli/` (Linux).

### 5. Register in your AI tool

See [Registration](#registration) below. Restart the AI tool after registering.

### 6. Verify

```bash
source gog.config
GOG_KEYRING_PASSWORD=$(op read "op://${OP_VAULT}/${OP_ITEM_KEYRING_PW:-GOG Keyring Password}/password" --account "$OP_ACCOUNT") \
  gog --account "$GOG_ACCOUNT" --json --no-input auth status
```

---

## gog.config reference

| Key | Required | Description |
|-----|----------|-------------|
| `OP_VAULT` | ✓ | 1Password vault name |
| `OP_ACCOUNT` | ✓ | 1Password account subdomain |
| `GOG_ACCOUNT` | ✓ | Google account email for this deployment |
| `OP_ITEM_OAUTH` | — | 1Password item for OAuth credentials (default: `Google Workspace OAuth`) |
| `OP_ITEM_TOKENS` | — | 1Password item for OAuth tokens (default: `GOG OAuth Tokens`) |
| `OP_ITEM_KEYRING_PW` | — | 1Password item for keyring password (default: `GOG Keyring Password`) |
| `GOG_PATH` | — | Path to gog binary (default: `/opt/homebrew/bin/gog`) |

---

## Registration

All clients use `run.sh` as the entrypoint. It sources `gog.config`, injects the keyring password from 1Password, then exec's the node process.

### Claude Code (user scope — all projects)

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "gog": {
      "type": "stdio",
      "command": "/Users/YOU/Projects/gog/run.sh",
      "args": [],
      "env": {}
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gog": {
      "command": "/Users/YOU/Projects/gog/run.sh",
      "args": []
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gog": {
      "command": "/Users/YOU/Projects/gog/run.sh",
      "args": []
    }
  }
}
```

### Per-project account override

Put a `.mcp.json` in any project root to bind that project to a specific Google account:

```json
{
  "mcpServers": {
    "gog": {
      "type": "stdio",
      "command": "/Users/YOU/Projects/gog/run.sh",
      "args": [],
      "env": { "GOG_ACCOUNT": "other@example.com" }
    }
  }
}
```

---

## Corporate / Agent deployment

To deploy gog for a shared corporate agent (e.g. `agent@company.com`):

### First-time setup (admin only)

1. **Create a 1Password vault** for the team (e.g. `CorpAgents`)

2. **Create three 1Password items** in that vault:
   - `Google Workspace OAuth` — fields: `client_id`, `client_secret`
   - `GOG OAuth Tokens` — fields: `default_token`, `account_token` (filled in step 4)
   - `GOG Keyring Password` — field: `password` (generate a strong random password)

3. **Set up the agent account on your Mac:**
   ```bash
   # Point to the new vault
   cat > gog.config <<EOF
   OP_VAULT="CorpAgents"
   OP_ACCOUNT="yourcompany.1password.com"
   GOG_ACCOUNT="agent@company.com"
   EOF

   ./setup-from-op.sh   # pulls OAuth client creds from vault
   ```

4. **Authenticate the agent account** (one-time browser OAuth flow):
   ```bash
   source gog.config
   GOG_KEYRING_PASSWORD=$(op read "op://${OP_VAULT}/GOG Keyring Password/password" --account "$OP_ACCOUNT") \
     gog auth add agent@company.com
   ```

5. **Push tokens to 1Password:**
   ```bash
   ./sync-to-op.sh
   ```
   This stores the tokens in `GOG OAuth Tokens` so every team member and deployment can pull them.

### Each team member

1. Clone the repo and run `./setup.sh`
2. Create `gog.config` with the team vault name and agent email
3. Run `./setup-from-op.sh`
4. Register in their AI tool of choice

### Token refresh

Google OAuth tokens expire. When they do:
1. Someone with desktop 1Password access runs `gog auth add agent@company.com` (browser flow)
2. Runs `./sync-to-op.sh` to push fresh tokens to 1Password
3. Team members run `./setup-from-op.sh` to pull the updated tokens

---

## Auth architecture

**Single source of truth: your 1Password vault.**

```
1Password vault
  "Google Workspace OAuth"  -->  cogcli/credentials.json   (OAuth app credentials)
  "GOG OAuth Tokens"        -->  cogcli/keyring/token:*    (refresh tokens)
  "GOG Keyring Password"    -->  GOG_KEYRING_PASSWORD env  (unlocks encrypted keyring)
```

- **`setup-from-op.sh`** — pulls secrets from 1Password to disk (run once per machine)
- **`run.sh`** — injects the keyring password at MCP server startup (no secrets at rest in config)
- **`sync-to-op.sh`** — pushes fresh tokens back to 1Password after re-authentication

---

## gogcli binary

Per this project's security policy, binaries are always built from source rather than downloaded pre-built.

### Build from source (recommended — required for advanced Docs features)

```bash
# Prerequisites: Go 1.22+ (brew install go)
git clone https://github.com/steipete/gogcli ~/Projects/gogcli
cd ~/Projects/gogcli
# Audit the code, then:
go build -o gog ./cmd/gog/
```

Set `GOG_PATH` in your `gog.config` to point to the built binary.

### Homebrew (simpler, fewer features)

```bash
brew install gogcli
```

The server defaults to `/opt/homebrew/bin/gog`. The Homebrew build lacks local formatting modifications (`docs_sed` rich formatting flags, `docs_format`, `docs_update` extended flags). For full feature support, build from source.

---

## VPS / Server deployment

For deploying to a Linux server (e.g. as part of a cloud AI agent stack):

### Prerequisites on the server

```bash
# Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# gogcli — build from source (requires Go 1.22+)
# Or cross-compile on your Mac and scp the binary:
#   GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o gog-linux-amd64 ./cmd/gog/
#   scp gog-linux-amd64 root@<YOUR_VPS_IP>:/usr/local/bin/gog
```

### Deploy the MCP server

```bash
# On your Mac — package and upload
cd ~/Projects/gog
npm run build
tar czf /tmp/gog-mcp.tar.gz dist/ node_modules/ package.json

scp /tmp/gog-mcp.tar.gz root@<YOUR_VPS_IP>:/root/
ssh root@<YOUR_VPS_IP> 'mkdir -p /root/gog-mcp && tar xzf /root/gog-mcp.tar.gz -C /root/gog-mcp/'
```

### Set up credentials on the server

```bash
# On the server — create gog.config with your vault settings
cat > /root/gog-mcp/gog.config <<EOF
OP_VAULT="YourVault"
OP_ACCOUNT="yourcompany.1password.com"
GOG_ACCOUNT="agent@yourcompany.com"
EOF

# Pull credentials from 1Password
cd /root/gog-mcp && ./setup-from-op.sh
```

The `setup-from-op.sh` script detects Linux and writes credentials to `~/.config/gogcli/`.

### Runtime configuration

On the server, `run.sh` is optional — you can call node directly and inject env vars via your process manager or orchestration layer:

```json
{
  "command": "node",
  "args": ["/root/gog-mcp/dist/index.js"],
  "env": {
    "GOG_PATH": "/usr/local/bin/gog",
    "GOG_ACCOUNT": "agent@yourcompany.com",
    "GOG_KEYRING_PASSWORD": "${GOG_KEYRING_PASSWORD}"
  }
}
```

`GOG_KEYRING_PASSWORD` should come from your secrets manager (1Password, Vault, etc.) — never hardcoded.

### Redeployment after code changes

```bash
# 1. Rebuild on Mac
cd ~/Projects/gog && npm run build
tar czf /tmp/gog-mcp.tar.gz dist/ node_modules/ package.json

# 2. Upload and extract
scp /tmp/gog-mcp.tar.gz root@<YOUR_VPS_IP>:/root/
ssh root@<YOUR_VPS_IP> 'tar xzf /root/gog-mcp.tar.gz -C /root/gog-mcp/'

# 3. Restart your gateway / process manager
```

---

## Configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `GOG_PATH` | Path to gog binary | `/opt/homebrew/bin/gog` |
| `GOG_ACCOUNT` | Default Google account email | _(from `gog.config`)_ |
| `GOG_KEYRING_PASSWORD` | Unlocks file-based keyring | _(injected by `run.sh` from 1Password)_ |

---

## Tools (40)

| Category | Tools |
|----------|-------|
| Meta | `gog_status`, `gog_raw` |
| Gmail | `gmail_search`, `gmail_messages_search`, `gmail_get`, `gmail_send`, `gmail_draft_create`, `gmail_draft_send` |
| Calendar | `calendar_events`, `calendar_create`, `calendar_update`, `calendar_delete`, `calendar_search` |
| Drive | `drive_ls`, `drive_search`, `drive_upload`, `drive_download`, `drive_mkdir`, `drive_rename`, `drive_delete`, `drive_move`, `drive_share` |
| Docs | `docs_cat`, `docs_create`, `docs_write`, `docs_update`, `docs_format`, `docs_insert`, `docs_find_replace`, `docs_sed` |
| Docs Comments | `docs_comments_list`, `docs_comments_get`, `docs_comments_add`, `docs_comments_reply`, `docs_comments_resolve`, `docs_comments_delete` |
| Sheets | `sheets_get`, `sheets_update`, `sheets_append` |
| Contacts | `contacts_list` |

---

## History

- **2026-03-02** — Initial version. Extracted Google Workspace access into a standalone Mac-native MCP service. Used macOS Keychain for auth.
- **2026-03-08** — Switched from Keychain to 1Password-backed file keyring.
- **2026-03-23** — Cloned gogcli from source (v0.12.0), built locally.
- **2026-03-26** — Added rich Docs formatting: `docs_update`, `docs_format`, Drive tools: `drive_rename`, `drive_delete`, `drive_move`. (30→36 tools)
- **2026-03-27** — Deployed to Linux VPS.
- **2026-03-29** — Added Docs comment tools (6 new). (36 tools)
- **2026-04-07** — Added `docs_insert`, `docs_find_replace`. (38 tools)
- **2026-04-08** — Added `drive_share`. Validated full image insertion pipeline. (39 tools)
- **2026-04-11** — Added `docs_sed` (SEDMAT engine). Added gog-over-docx-js directive. (40 tools)
- **2026-04-22** — Refactored to multi-tenant config (`gog.config`). Added corporate agent deployment section.
