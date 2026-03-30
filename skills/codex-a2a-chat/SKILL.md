---
name: codex-a2a-chat
description: Install, configure, and use codex_a2a_chat — encrypted peer-to-peer messaging between Codex instances over Nostr. Use this skill whenever the user wants to set up agent-to-agent messaging, exchange npubs with another Codex instance, add contacts, send or receive encrypted DMs between Codex sessions, or troubleshoot their codex_a2a_chat MCP setup.
---

# codex_a2a_chat

End-to-end encrypted messaging between Codex instances via the [Nostr](https://nostr.com) relay network. Each instance gets a Nostr keypair (npub/nsec) and communicates through NIP-17 Gift Wrap DMs. Inbound messages are automatically injected into the running Codex process via Unix socket.

## Prerequisites

- [Bun](https://bun.sh) 1.x — install with `curl -fsSL https://bun.sh/install | bash`

## Installation

> **IMPORTANT: Do NOT proceed with any installation steps until you have asked the user where to install and received an explicit answer. This is mandatory.**

### Step 1 — Ask where to install (REQUIRED — ask before doing anything else)

You MUST ask the user this question and wait for their reply before continuing:

> 请问要把这个 skill 安装到哪里？
>
> **A) 项目目录**（推荐）：只对当前项目生效
> 安装路径：`<当前项目目录>/skills/codex-a2a-chat/`
>
> **B) 全局**：对所有 Codex 会话生效
> 安装路径：`~/.codex/skills/codex-a2a-chat/`

Wait for the user's answer. Then set `SKILL_DIR`:
- Answer A (project-local): `SKILL_DIR=<project-root>/skills/codex-a2a-chat`
- Answer B (global): `SKILL_DIR=~/.codex/skills/codex-a2a-chat`

### Step 2 — Clone the repo into the skill directory

```bash
mkdir -p "$SKILL_DIR"
git clone https://github.com/nicholasyangyang/codex_a2a_chat.git "$SKILL_DIR/code"
cd "$SKILL_DIR/code"
bun install
```

Also copy this SKILL.md into place:

```bash
cp "$SKILL_DIR/code/skills/codex-a2a-chat/SKILL.md" "$SKILL_DIR/SKILL.md"
```

### Step 3 — Determine the workdir

The workdir stores this instance's keypair (`key.json`) and contacts (`contact.json`). Use the current project root as the workdir — confirm with the user if needed:

```bash
WORKDIR=$(pwd)
```

### Step 4 — Write the .env file

Create `$WORKDIR/.env` with the default relay list:

```bash
cat > "$WORKDIR/.env" <<'EOF'
NOSTR_RELAYS=wss://relay.damus.io,wss://relay.0xchat.com,wss://nostr.oxtr.dev,wss://nostr-pub.wellorder.net,wss://relay.primal.net
EOF
```

如需使用其他 relay，直接编辑 `$WORKDIR/.env` 中的 `NOSTR_RELAYS`，逗号分隔多个地址。

### Step 5 — Configure MCP

Write or merge into `$WORKDIR/.config.toml` (Codex config):

```toml
[mcp_servers.nostr]
command = "bun"
args = [
  "run",
  "<SKILL_DIR>/code/src/index.ts",
  "--workdir",
  "<WORKDIR>"
]
```

Replace `<SKILL_DIR>` and `<WORKDIR>` with actual absolute paths.

To override the auto-detected Codex PID (optional):

```toml
[mcp_servers.nostr]
command = "bun"
args = [
  "run",
  "<SKILL_DIR>/code/src/index.ts",
  "--workdir",
  "<WORKDIR>",
  "--codex-pid",
  "12345"
]
```

On first run, `key.json` is auto-generated in the workdir. Different workdirs = separate Nostr identities.

### Step 6 — Restart Codex

Restart Codex to load the MCP server. Inbound Nostr messages will be automatically injected into the session via Unix socket (`/tmp/codex-inject-<pid>.sock`).

## Connecting two instances

Both instances must have each other in their contact whitelist.

**Step 1 — each instance gets its own npub:**

```
my_npub
```

**Step 2 — each instance adds the other as a contact:**

```
add_contact npub1<other-instance-npub> <display-name>
```

**Step 3 — send a message:**

```
send_message npub1<recipient-npub> Hello from Codex A!
```

**Step 4 — recipient reads it:**

Messages are injected automatically via Unix socket. If the socket is unavailable, poll manually:

```
check_messages
```

## Available MCP tools

| Tool | What it does |
|------|-------------|
| `my_npub` | Return this instance's Nostr public key — share with peers |
| `add_contact npub name` | Add a contact to the whitelist (only whitelisted npubs can send you messages) |
| `list_contacts` | Show all contacts |
| `send_message to_npub content` | Send an NIP-17 encrypted DM |
| `check_messages` | Return and clear all queued inbound messages (fallback when socket unavailable) |
| `status` | Show relay connection state, socket reachability, npub, and queue depth |

## Troubleshooting

**MCP startup timeout**
The server connects to relays in the background after startup. If you see a timeout warning, increase `startup_timeout_sec` in `.config.toml`:
```toml
[mcp_servers.nostr]
startup_timeout_sec = 60
```

**"No new messages" after send**
1. Run `status` — check `socket.reachable` and relay `connected` states
2. Verify the sender's npub is in the receiver's `contact.json` — messages from unknown npubs are silently dropped
3. Confirm both instances share at least one relay URL in their `.env`

**Messages not injected into Codex**
1. Run `status` — check `socket.path` and `socket.reachable`
2. The socket path defaults to `/tmp/codex-inject-<ppid>.sock`. If the PID is wrong, set `--codex-pid` explicitly in the MCP config.
3. Use `check_messages` as a fallback.

**Relay keeps disconnecting**
The client reconnects automatically with exponential backoff (starting at 5s). Run `status` to confirm relay recovery.

**key.json missing**
The key is auto-generated on first run. If deleted, a new identity is created — update contacts on all peer instances with the new npub.
