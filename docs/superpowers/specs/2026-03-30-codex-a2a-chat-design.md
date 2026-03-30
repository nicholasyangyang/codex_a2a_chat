# codex_a2a_chat Design Spec

**Date**: 2026-03-30
**Status**: Approved

---

## Overview

`codex_a2a_chat` is a Nostr-based encrypted P2P messaging MCP server for Codex instances. It mirrors the functionality of `cc_a2a_chat` (Claude Code A2A chat) but targets Codex integration by replacing the `notifications/claude/channel` push mechanism with Unix socket injection into running Codex processes.

---

## Goals

- Enable encrypted agent-to-agent messaging between Codex instances via Nostr relays
- Auto-detect the running Codex process (via `process.ppid`) to inject inbound messages without manual configuration
- Retain `check_messages` as a fallback when socket injection is unavailable
- Expose the same 6 MCP tools as `cc_a2a_chat`

---

## Architecture

### Single Process Model

One process handles:
1. MCP server (stdio transport) — exposes 6 tools to Codex
2. Nostr client — connects to relays, encrypts/decrypts messages
3. Background injection — on message receipt, attempts Unix socket injection into Codex

### File Structure

```
codex_a2a_chat/
├── src/
│   ├── index.ts           # MCP server entry + socket injection logic
│   ├── nostr.ts           # Nostr client (NIP-17 + NIP-44 v2)
│   ├── contacts.ts        # Contact whitelist management
│   ├── keys.ts            # Keypair generation and persistence
│   ├── types.ts           # TypeScript type definitions
│   └── codex-inject.ts    # Unix socket injection for Codex
├── tests/
│   ├── nostr.test.ts
│   ├── keys.test.ts
│   ├── contacts.test.ts
│   └── codex-inject.test.ts
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-03-30-codex-a2a-chat-design.md
├── package.json
├── tsconfig.json
└── .gitignore
```

### Modules

| Module | Source | Notes |
|--------|--------|-------|
| `nostr.ts` | Copied from `cc_a2a_chat/src/nostr.ts` | No changes needed |
| `contacts.ts` | Copied from `cc_a2a_chat/src/contacts.ts` | No changes needed |
| `keys.ts` | Copied from `cc_a2a_chat/src/keys.ts` | No changes needed |
| `types.ts` | Based on `cc_a2a_chat/src/types.ts` | Add `SocketStatus` type |
| `codex-inject.ts` | Ported from `codex-channel/lib/codex-inject.ts` | Adapted for Bun |
| `index.ts` | New, based on `cc_a2a_chat/src/index.ts` | Remove channel loop, add socket injection |

---

## CLI Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--workdir <dir>` | Yes | — | Directory for key.json, contact.json, .env |
| `--codex-pid <pid>` | No | auto-detect | Override Codex PID for socket path |

---

## PID Auto-Detection

PID resolution priority (first match wins):

1. `--codex-pid` CLI argument
2. `process.ppid` — MCP server is a child process of Codex, so parent PID = Codex PID

Socket path: `/tmp/codex-inject-<pid>.sock`

---

## Initialization Flow

```
1. Parse --workdir (required), --codex-pid (optional)
2. Resolve PID: --codex-pid → process.ppid
3. Set socketPath = /tmp/codex-inject-<pid>.sock
4. Load .env from workdir → get relay URLs
5. loadOrGenerateKey(workdir) → keypair
6. loadContacts(workdir) → contact whitelist
7. Create NostrClient with onMessage callback
8. NostrClient.connect() → subscribe to relays
9. Start MCP server (stdio transport)
```

---

## Message Flow

### Inbound (Receive)

```
Nostr relay → kind:1059 (gift wrap event)
    → NostrClient.handleEvent()
        → unwrapGiftWrap() → decrypt NIP-17 layers
        → isAllowed(contacts, senderNpub)? → drop if not
        → onMessage({ from_npub, from_name, content, received_at })
            → messageQueue.push(msg)
            → attempt socket injection:
                connect /tmp/codex-inject-<pid>.sock
                send: JSON.stringify({ text: "[P2P from {name}]\n{content}" }) + "\n"
                success → Codex receives real-time notification
                failure → silent, message stays in queue
```

### Outbound (Send)

```
MCP tool: send_message(to_npub, content)
    → NostrClient.send(to_npub, content)
        → createGiftWrap() → NIP-17 3-layer encryption
        → publish to all connected relays
```

### Socket Reconnect Strategy

Each inbound message triggers a fresh connection attempt to the socket. No persistent connection is maintained. This naturally handles Codex restarts (socket path is stable, connection is re-established on next message).

---

## MCP Tools

| Tool | Inputs | Behavior |
|------|--------|----------|
| `send_message` | `to_npub: string`, `content: string` | Encrypt and send via Nostr relays |
| `check_messages` | — | Drain and return queued messages (fallback) |
| `add_contact` | `npub: string`, `name: string` | Add to whitelist, persist to contact.json |
| `list_contacts` | — | Return all whitelisted contacts |
| `my_npub` | — | Return this instance's public key |
| `status` | — | Relay connection states, queue size, socket path + reachability |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Socket not found | Silent; message stays in queue |
| Socket connection refused | Silent; message stays in queue |
| Relay disconnect | Auto-reconnect every 5s (from nostr.ts) |
| Unknown sender (not in contacts) | Silently dropped |
| Malformed Nostr event | Silently dropped (try/catch in handleEvent) |
| Invalid --workdir | Throw with clear error message on startup |

---

## Data Formats

**key.json**:
```json
{ "npub": "npub1...", "nsec": "nsec1..." }
```

**contact.json**:
```json
{ "contacts": [{ "npub": "npub1...", "name": "Alice" }] }
```

**Socket injection payload**:
```json
{ "text": "[P2P from Alice]\nHello from the other side" }
```

---

## Testing

| Test File | Coverage |
|-----------|----------|
| `nostr.test.ts` | NIP-17 encrypt/decrypt, relay status, whitelist enforcement, malformed events |
| `keys.test.ts` | Generate, persist, load, encode/decode |
| `contacts.test.ts` | Load, add, dedup, whitelist check |
| `codex-inject.test.ts` | findCodexSocket with/without PID, injectMessage success/failure, JSON format |

**Framework**: `bun:test`

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP protocol |
| `nostr-tools` | ^2.23.3 | Nostr encryption + serialization |

**Runtime**: Bun 1.x

---

## Key Differences from cc_a2a_chat

| Aspect | cc_a2a_chat | codex_a2a_chat |
|--------|-------------|----------------|
| Push mechanism | `notifications/claude/channel` (500ms loop) | Unix socket injection (per-message) |
| Target runtime | Claude Code | Codex |
| PID detection | N/A | `process.ppid` → `--codex-pid` override |
| New module | — | `codex-inject.ts` |
| `check_messages` | Primary pull mechanism | Fallback when socket unavailable |
