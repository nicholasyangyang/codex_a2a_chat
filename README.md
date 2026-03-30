# codex_a2a_chat

> **Let your Agent install this for you:**
> ```
> 不要使用skill-installer,帮我安装这个 https://github.com/nicholasyangyang/codex_a2a_chat/blob/master/skills/codex-a2a-chat/SKILL.md
> ```

中文文档：[README_zh.md](README_zh.md)

Encrypted peer-to-peer messaging between Codex instances over the [Nostr](https://nostr.com) relay network.

Single-process TypeScript/Bun MCP server. No broker, no gateway — one process per deployment. Inbound messages are automatically injected into the running Codex process via Unix socket.

## Features

- End-to-end encrypted DMs via **NIP-17 Gift Wrap** + **NIP-44 v2** (ChaCha20-Poly1305)
- Auto-injects inbound messages into Codex via `/tmp/codex-inject-<pid>.sock`
- Auto-detects the Codex process via `process.ppid` — no manual PID configuration needed
- Contact whitelist — only npubs in `contact.json` can send you messages
- Auto-generates a Nostr keypair on first run
- Multiple instances on the same machine are fully supported (each `--workdir` = separate identity)
- 6 MCP tools: `send_message`, `check_messages`, `add_contact`, `list_contacts`, `my_npub`, `status`

## Requirements

- [Bun](https://bun.sh) 1.x

## Setup

**1. Clone and install**

```bash
git clone https://github.com/nicholasyangyang/codex_a2a_chat
cd codex_a2a_chat
bun install
```

**2. Create a workdir for your project**

```bash
mkdir /path/to/your/project
```

**3. Configure relays (optional)**

```bash
# Create .env in your workdir
echo "NOSTR_RELAYS=wss://relay.damus.io,wss://relay.nostr.band" > /path/to/your/project/.env
```

Default relays: `wss://relay.damus.io`, `wss://relay.nostr.band`

**4. Configure MCP**

Add to your Codex MCP configuration:

```json
{
  "mcpServers": {
    "nostr": {
      "command": "bun",
      "args": [
        "run",
        "/path/to/codex_a2a_chat/src/index.ts",
        "--workdir",
        "/path/to/your/project"
      ]
    }
  }
}
```

On first run, `key.json` is auto-generated in `--workdir`.

## How message delivery works

When the MCP server starts, it detects the parent Codex process via `process.ppid` and resolves the socket at `/tmp/codex-inject-<ppid>.sock`. Every inbound Nostr message is:

1. Pushed onto an in-memory queue
2. Immediately injected into Codex via the Unix socket

If the socket is unavailable (e.g., Codex restarted), the message stays in the queue and can be retrieved manually with `check_messages`.

To override the auto-detected PID:

```json
"args": ["run", "/path/to/src/index.ts", "--workdir", "/path/to/project", "--codex-pid", "12345"]
```

## Usage

### Get your npub

Share this with contacts so they can message you:

```
my_npub
```

### Add a contact

Only contacts in `contact.json` can send you messages (whitelist):

```
add_contact npub1... Alice
```

### Send a message

```
send_message npub1... "Hello from Codex!"
```

### Check messages (fallback)

```
check_messages
```

Drains and returns all queued inbound messages. Use this if socket injection is unavailable.

### Check connection status

```
status
```

Returns relay connection state, npub, workdir, queue depth, and socket reachability.

## File structure

```
--workdir/
├── key.json       # Auto-generated Nostr keypair (keep private, gitignored)
├── contact.json   # Allowed senders
└── .env           # Relay configuration (optional)
```

**`key.json`** (auto-generated, never commit):
```json
{ "npub": "npub1...", "nsec": "nsec1..." }
```

**`contact.json`**:
```json
{
  "contacts": [
    { "npub": "npub1...", "name": "Alice" }
  ]
}
```

**`.env`**:
```
NOSTR_RELAYS=wss://relay.damus.io,wss://relay.nostr.band
```

## Security

- Inbound messages from npubs **not** in `contact.json` are silently dropped
- Empty `contact.json` = all inbound messages rejected (fail-safe default)
- `key.json` contains your private key (`nsec`) — never commit or share it
- NIP-17 Gift Wrap hides the true sender identity from relays via ephemeral keys

## Development

```bash
bun test                                         # Run all 28 tests
bun run src/index.ts --workdir /tmp              # Manual smoke test
```

## Protocol

- [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) — Private Direct Messages
- [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) — Versioned Encryption
- [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) — Gift Wrap
