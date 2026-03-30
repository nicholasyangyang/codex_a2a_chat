#!/usr/bin/env bash
set -e

# codex_a2a_chat installer
# Usage:
#   Global:       bash install.sh
#   Project-local: bash install.sh --local
#   Workdir:      bash install.sh --workdir /path/to/project

LOCAL=0
WORKDIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) LOCAL=1; shift ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ $LOCAL -eq 1 ]]; then
  SKILL_DIR="$(pwd)/.codex/skills/codex-a2a-chat"
else
  SKILL_DIR="$HOME/.codex/skills/codex-a2a-chat"
fi

echo "Installing codex-a2a-chat to: $SKILL_DIR"

mkdir -p "$SKILL_DIR"
git clone https://github.com/nicholasyangyang/codex_a2a_chat.git "$SKILL_DIR/code"
cd "$SKILL_DIR/code"
bun install
cp "$SKILL_DIR/code/skills/codex-a2a-chat/SKILL.md" "$SKILL_DIR/SKILL.md"

if [[ -n "$WORKDIR" ]]; then
  mkdir -p "$WORKDIR"
  if [[ ! -f "$WORKDIR/.env" ]]; then
    echo "NOSTR_RELAYS=wss://relay.damus.io,wss://relay.0xchat.com,wss://nostr.oxtr.dev,wss://nostr-pub.wellorder.net,wss://relay.primal.net" > "$WORKDIR/.env"
    echo "Created $WORKDIR/.env with default relays"
  fi
fi

echo ""
echo "Done! Restart Codex to load the skill."
echo ""
echo "MCP config to add to .config.toml:"
echo ""
echo "[mcp_servers.nostr]"
echo "command = \"bun\""
echo "args = ["
echo "  \"run\","
echo "  \"$SKILL_DIR/code/src/index.ts\","
echo "  \"--workdir\","
echo "  \"${WORKDIR:-/path/to/your/project}\""
echo "]"
