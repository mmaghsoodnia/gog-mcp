#!/usr/bin/env bash
# Pushes current gog OAuth tokens back to 1Password.
#
# Use this after re-authenticating (gog auth add <email>) to sync the new
# tokens to 1Password so other machines and deployments pick them up.
#
# Requires desktop 1Password CLI with Touch ID — service account tokens
# are read-only and cannot write back to 1Password.
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

for var in OP_VAULT OP_ACCOUNT GOG_ACCOUNT; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set in gog.config."
    exit 1
  fi
done

OP_ITEM_TOKENS="${OP_ITEM_TOKENS:-GOG OAuth Tokens}"

# gogcli config dir (platform-aware)
if [[ "$(uname)" == "Darwin" ]]; then
  GOG_DIR="${HOME}/Library/Application Support/gogcli"
else
  GOG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/gogcli"
fi

DEFAULT_TOKEN="$GOG_DIR/keyring/token:default:${GOG_ACCOUNT}"
ACCOUNT_TOKEN="$GOG_DIR/keyring/token:${GOG_ACCOUNT}"

for f in "$DEFAULT_TOKEN" "$ACCOUNT_TOKEN"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: Token file not found: $f"
    echo "       Run 'gog auth add ${GOG_ACCOUNT}' first to authenticate."
    exit 1
  fi
done

echo "Encoding tokens and pushing to 1Password..."
echo "  Vault: $OP_VAULT / $OP_ITEM_TOKENS  ($OP_ACCOUNT)"
echo ""

DEFAULT_B64=$(base64 < "$DEFAULT_TOKEN")
ACCOUNT_B64=$(base64 < "$ACCOUNT_TOKEN")

# Requires desktop 1Password with Touch ID (service account is read-only)
op item edit "$OP_ITEM_TOKENS" \
  --vault "$OP_VAULT" \
  --account "$OP_ACCOUNT" \
  "default_token=$DEFAULT_B64" \
  "account_token=$ACCOUNT_B64"

echo ""
echo "✓ 1Password '$OP_ITEM_TOKENS' updated."
echo "  Other machines will pick up the new tokens on their next setup-from-op.sh run."
