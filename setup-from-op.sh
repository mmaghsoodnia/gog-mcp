#!/usr/bin/env bash
# Reconstructs the gogcli config directory from 1Password.
#
# Reads vault/account/email settings from gog.config (see gog.config.example).
# Run once on a fresh machine, or after tokens are rotated in 1Password.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/gog.config"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: gog.config not found."
  echo "       Copy gog.config.example to gog.config and fill in your settings."
  exit 1
fi

# shellcheck source=/dev/null
source "$CONFIG_FILE"

# Validate required config
for var in OP_VAULT OP_ACCOUNT GOG_ACCOUNT; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set in gog.config."
    exit 1
  fi
done

# Apply item name defaults
OP_ITEM_OAUTH="${OP_ITEM_OAUTH:-Google Workspace OAuth}"
OP_ITEM_TOKENS="${OP_ITEM_TOKENS:-GOG OAuth Tokens}"
OP_ITEM_KEYRING_PW="${OP_ITEM_KEYRING_PW:-GOG Keyring Password}"

# gogcli config dir (platform-aware)
if [[ "$(uname)" == "Darwin" ]]; then
  GOG_DIR="${HOME}/Library/Application Support/gogcli"
else
  GOG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/gogcli"
fi

# Load 1Password service account token
if [[ -f ~/.op-service-account-token ]]; then
  export OP_SERVICE_ACCOUNT_TOKEN=$(<~/.op-service-account-token)
else
  echo "ERROR: ~/.op-service-account-token not found."
  echo "       Place your 1Password service account token there first."
  exit 1
fi

echo "Setting up gog credentials from 1Password..."
echo "  Vault:   $OP_VAULT @ $OP_ACCOUNT"
echo "  Account: $GOG_ACCOUNT"
echo ""

mkdir -p "$GOG_DIR/keyring"

# 1. Static config — file-based keyring (not macOS Keychain)
echo '{"keyring_backend": "file"}' > "$GOG_DIR/config.json"

# 2. OAuth client credentials from 1Password
printf '{"client_id":"%s","client_secret":"%s"}\n' \
  "$(op read "op://${OP_VAULT}/${OP_ITEM_OAUTH}/client_id" --account "$OP_ACCOUNT" | tr -d '\n\r')" \
  "$(op read "op://${OP_VAULT}/${OP_ITEM_OAUTH}/client_secret" --account "$OP_ACCOUNT" | tr -d '\n\r')" \
  > "$GOG_DIR/credentials.json"

# 3. OAuth tokens from 1Password (stored base64-encoded; filenames include the email)
op read "op://${OP_VAULT}/${OP_ITEM_TOKENS}/default_token" --account "$OP_ACCOUNT" \
  | base64 -d > "$GOG_DIR/keyring/token:default:${GOG_ACCOUNT}"

op read "op://${OP_VAULT}/${OP_ITEM_TOKENS}/account_token" --account "$OP_ACCOUNT" \
  | base64 -d > "$GOG_DIR/keyring/token:${GOG_ACCOUNT}"

# Lock down permissions
chmod 700 "$GOG_DIR" "$GOG_DIR/keyring"
chmod 600 "$GOG_DIR/config.json" "$GOG_DIR/credentials.json" "$GOG_DIR/keyring/"*

echo "✓ gog credentials ready at: $GOG_DIR"
echo ""
echo "Test with:"
echo "  GOG_KEYRING_PASSWORD=\$(op read 'op://${OP_VAULT}/${OP_ITEM_KEYRING_PW}/password' --account '${OP_ACCOUNT}') \\"
echo "    gog --account '${GOG_ACCOUNT}' --json --no-input auth status"
