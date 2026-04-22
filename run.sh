#!/usr/bin/env bash
# Launcher for the gog MCP server.
# Sources gog.config for vault/account settings, reads GOG_KEYRING_PASSWORD
# from 1Password, then exec's the node process.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# Load local config (gitignored — each deployer creates this from gog.config.example)
CONFIG_FILE="$DIR/gog.config"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi

# Validate required config
if [[ -z "${OP_VAULT:-}" || -z "${OP_ACCOUNT:-}" ]]; then
  echo "ERROR: OP_VAULT and OP_ACCOUNT must be set (in gog.config or environment)." >&2
  echo "       See gog.config.example for a template." >&2
  exit 1
fi
OP_ITEM_KEYRING_PW="${OP_ITEM_KEYRING_PW:-GOG Keyring Password}"

# Inject keyring password from 1Password if not already set
if [[ -z "${GOG_KEYRING_PASSWORD:-}" ]]; then
  if [[ ! -f ~/.op-service-account-token ]]; then
    echo "ERROR: ~/.op-service-account-token not found." >&2
    echo "       Place your 1Password service account token there," >&2
    echo "       or set GOG_KEYRING_PASSWORD directly in your environment." >&2
    exit 1
  fi
  export OP_SERVICE_ACCOUNT_TOKEN=$(<~/.op-service-account-token)
  GOG_KEYRING_PASSWORD=$(op read "op://${OP_VAULT}/${OP_ITEM_KEYRING_PW}/password" --account "$OP_ACCOUNT" | tr -d '\n\r')
  export GOG_KEYRING_PASSWORD
fi

# Export Google account (can be overridden by a project-level .mcp.json env block)
export GOG_ACCOUNT="${GOG_ACCOUNT:-}"

# Export gog binary path only if explicitly configured
# If unset, the MCP server falls back to its own default (/opt/homebrew/bin/gog)
if [[ -n "${GOG_PATH:-}" ]]; then
  export GOG_PATH
fi

exec node "$DIR/dist/index.js"
