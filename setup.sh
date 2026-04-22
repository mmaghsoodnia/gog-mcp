#!/usr/bin/env bash
# gog-mcp setup — run once to install dependencies and build the server
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: node not found in PATH."
  echo "       Install Node.js 22+:"
  echo "         macOS:  brew install node@22 && brew link node@22"
  echo "         Linux:  https://nodejs.org or your distro's package manager"
  exit 1
fi

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "WARNING: Node.js $(node --version) detected. Node 22+ is recommended."
fi

echo "Installing dependencies..."
npm install

echo "Building TypeScript..."
npm run build

echo ""
echo "✓ MCP server built at: $DIR/dist/index.js"
echo ""
echo "Next steps:"
echo "  1. Copy gog.config.example → gog.config and fill in your settings"
echo "  2. Run ./setup-from-op.sh  to pull credentials from 1Password"
echo "  3. Register in Claude Code — see README.md"
