# codex_a2a_chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Nostr-based encrypted P2P MCP server for Codex that auto-injects inbound messages into Codex via Unix socket, mirroring `cc_a2a_chat` functionality.

**Architecture:** Single Bun process hosts an MCP server (6 tools) + a NostrClient (NIP-17/NIP-44 v2 encryption). When a message arrives it is pushed onto an in-memory queue and simultaneously injected into Codex via `/tmp/codex-inject-<ppid>.sock`. The `check_messages` tool drains the queue as a fallback when the socket is unavailable.

**Tech Stack:** Bun 1.x, TypeScript (ESNext), `@modelcontextprotocol/sdk ^1.27.1`, `nostr-tools ^2.23.3`, Node.js `net` module (for Unix socket, available in Bun).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Create | Bun project config, dependencies |
| `tsconfig.json` | Create | TypeScript settings |
| `.gitignore` | Modify (already exists) | Ensure correct exclusions |
| `src/types.ts` | Create | All shared TypeScript interfaces |
| `src/keys.ts` | Create | Keypair generate/load/encode/decode |
| `src/contacts.ts` | Create | Contact whitelist load/add/check |
| `src/codex-inject.ts` | Create | Find socket path, inject message via Unix socket |
| `src/nostr.ts` | Create | NostrClient: relay connections, NIP-17 encrypt/decrypt |
| `src/index.ts` | Create | MCP server, PID detection, socket injection on message receipt |
| `tests/keys.test.ts` | Create | Keypair lifecycle tests |
| `tests/contacts.test.ts` | Create | Contact whitelist tests |
| `tests/codex-inject.test.ts` | Create | Socket path detection and injection tests |
| `tests/nostr.test.ts` | Create | NIP-17 roundtrip, whitelist, relay tests |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "codex_a2a_chat",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "nostr-tools": "^2.23.3"
  },
  "devDependencies": {
    "bun-types": "latest"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 3: Verify .gitignore contains these entries (add if missing)**

```
node_modules/
key.json
.env
dist/
```

- [ ] **Step 4: Install dependencies**

```bash
cd /home/deeptuuk/CodeTeam/Code/codex_a2a_chat
bun install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore bun.lockb
git commit -m "chore: project scaffold"
```

---

### Task 2: Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create src/types.ts**

```typescript
export interface KeyPair {
  npub: string;
  nsec: string;
}

export interface Contact {
  npub: string;
  name: string;
}

export interface ContactList {
  contacts: Contact[];
}

export interface InboundMessage {
  from_npub: string;
  from_name: string | null;
  content: string;
  received_at: string;
}

export interface RelayStatus {
  url: string;
  connected: boolean;
}

export interface SocketStatus {
  path: string;
  reachable: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 3: Keypair Management

**Files:**
- Create: `src/keys.ts`
- Create: `tests/keys.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/keys.test.ts
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadOrGenerateKey, decodeNsec, decodeNpub } from '../src/keys.ts'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'codex_a2a_chat_'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true })
})

test('generates key.json when missing', () => {
  const keypair = loadOrGenerateKey(tmpDir)
  expect(keypair.npub).toMatch(/^npub1/)
  expect(keypair.nsec).toMatch(/^nsec1/)
})

test('persists generated key to disk', () => {
  loadOrGenerateKey(tmpDir)
  expect(existsSync(join(tmpDir, 'key.json'))).toBe(true)
})

test('loads existing key without regenerating', () => {
  const first = loadOrGenerateKey(tmpDir)
  const second = loadOrGenerateKey(tmpDir)
  expect(second.npub).toBe(first.npub)
  expect(second.nsec).toBe(first.nsec)
})

test('decodeNsec returns 32-byte Uint8Array', () => {
  const keypair = loadOrGenerateKey(tmpDir)
  const privkey = decodeNsec(keypair.nsec)
  expect(privkey).toBeInstanceOf(Uint8Array)
  expect(privkey.length).toBe(32)
})

test('decodeNpub returns 64-char hex string', () => {
  const keypair = loadOrGenerateKey(tmpDir)
  const pubkeyHex = decodeNpub(keypair.npub)
  expect(pubkeyHex).toMatch(/^[0-9a-f]{64}$/)
})

test('decodeNsec throws on invalid input', () => {
  expect(() => decodeNsec('invalid')).toThrow()
})

test('decodeNpub throws on invalid input', () => {
  expect(() => decodeNpub('invalid')).toThrow()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/deeptuuk/CodeTeam/Code/codex_a2a_chat
bun test tests/keys.test.ts
```

Expected: FAIL with "Cannot find module '../src/keys.ts'"

- [ ] **Step 3: Create src/keys.ts**

```typescript
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { KeyPair } from './types.ts'

export function loadOrGenerateKey(workdir: string): KeyPair {
  const keyPath = join(workdir, 'key.json')
  if (existsSync(keyPath)) {
    try {
      return JSON.parse(readFileSync(keyPath, 'utf-8')) as KeyPair
    } catch {
      throw new Error(`key.json exists at ${keyPath} but cannot be parsed — delete it to generate a new key`)
    }
  }
  const privkey = generateSecretKey()
  const pubkeyHex = getPublicKey(privkey)
  const keypair: KeyPair = {
    npub: nip19.npubEncode(pubkeyHex),
    nsec: nip19.nsecEncode(privkey),
  }
  writeFileSync(keyPath, JSON.stringify(keypair, null, 2))
  return keypair
}

export function decodeNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
  return decoded.data
}

export function decodeNpub(npub: string): string {
  const decoded = nip19.decode(npub)
  if (decoded.type !== 'npub') throw new Error('Invalid npub')
  return decoded.data
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/keys.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/keys.ts tests/keys.test.ts
git commit -m "feat: keypair generation and persistence"
```

---

### Task 4: Contact Whitelist

**Files:**
- Create: `src/contacts.ts`
- Create: `tests/contacts.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/contacts.test.ts
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadContacts, addContact, isAllowed } from '../src/contacts.ts'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'codex_a2a_chat_'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true })
})

test('returns empty array when contact.json missing', () => {
  expect(loadContacts(tmpDir)).toEqual([])
})

test('loads contacts from contact.json', () => {
  writeFileSync(
    join(tmpDir, 'contact.json'),
    JSON.stringify({ contacts: [{ npub: 'npub1abc', name: 'Alice' }] })
  )
  expect(loadContacts(tmpDir)).toEqual([{ npub: 'npub1abc', name: 'Alice' }])
})

test('addContact writes to contact.json', () => {
  addContact(tmpDir, 'npub1abc', 'Alice')
  expect(loadContacts(tmpDir)).toEqual([{ npub: 'npub1abc', name: 'Alice' }])
})

test('addContact does not duplicate existing npub', () => {
  addContact(tmpDir, 'npub1abc', 'Alice')
  addContact(tmpDir, 'npub1abc', 'Alice2')
  expect(loadContacts(tmpDir)).toHaveLength(1)
})

test('isAllowed returns false for empty contact list', () => {
  expect(isAllowed([], 'npub1anything')).toBe(false)
})

test('isAllowed returns true for listed npub', () => {
  const contacts = [{ npub: 'npub1alice', name: 'Alice' }]
  expect(isAllowed(contacts, 'npub1alice')).toBe(true)
})

test('isAllowed returns false for unlisted npub', () => {
  const contacts = [{ npub: 'npub1alice', name: 'Alice' }]
  expect(isAllowed(contacts, 'npub1eve')).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/contacts.test.ts
```

Expected: FAIL with "Cannot find module '../src/contacts.ts'"

- [ ] **Step 3: Create src/contacts.ts**

```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Contact, ContactList } from './types.ts'

export function loadContacts(workdir: string): Contact[] {
  const path = join(workdir, 'contact.json')
  if (!existsSync(path)) return []
  const data = JSON.parse(readFileSync(path, 'utf-8')) as ContactList
  return data.contacts ?? []
}

export function addContact(workdir: string, npub: string, name: string): Contact[] {
  const contacts = loadContacts(workdir)
  if (contacts.some(c => c.npub === npub)) return contacts
  const updated = [...contacts, { npub, name }]
  writeFileSync(join(workdir, 'contact.json'), JSON.stringify({ contacts: updated }, null, 2))
  return updated
}

export function isAllowed(contacts: Contact[], npub: string): boolean {
  if (contacts.length === 0) return false
  return contacts.some(c => c.npub === npub)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/contacts.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/contacts.ts tests/contacts.test.ts
git commit -m "feat: contact whitelist management"
```

---

### Task 5: Codex Unix Socket Injection

**Files:**
- Create: `src/codex-inject.ts`
- Create: `tests/codex-inject.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/codex-inject.test.ts
import { test, expect } from 'bun:test'
import { createServer } from 'net'
import { unlinkSync, existsSync } from 'fs'
import { findCodexSocketPath, injectMessage } from '../src/codex-inject.ts'

test('findCodexSocketPath returns path for given pid', () => {
  const path = findCodexSocketPath(12345)
  expect(path).toBe('/tmp/codex-inject-12345.sock')
})

test('findCodexSocketPath uses ppid when no pid given', () => {
  const path = findCodexSocketPath()
  expect(path).toBe(`/tmp/codex-inject-${process.ppid}.sock`)
})

test('injectMessage sends JSON line to Unix socket', async () => {
  const sockPath = '/tmp/codex-inject-test-99999.sock'
  if (existsSync(sockPath)) unlinkSync(sockPath)

  const received: string[] = []
  const server = createServer(socket => {
    socket.on('data', data => received.push(data.toString()))
  })

  await new Promise<void>(resolve => server.listen(sockPath, resolve))

  try {
    await injectMessage(sockPath, 'hello from test')
    await Bun.sleep(50)
    expect(received.join('')).toContain(JSON.stringify({ text: 'hello from test' }))
  } finally {
    server.close()
    if (existsSync(sockPath)) unlinkSync(sockPath)
  }
})

test('injectMessage rejects when socket does not exist', async () => {
  await expect(
    injectMessage('/tmp/codex-inject-nonexistent-99998.sock', 'hi')
  ).rejects.toThrow()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/codex-inject.test.ts
```

Expected: FAIL with "Cannot find module '../src/codex-inject.ts'"

- [ ] **Step 3: Create src/codex-inject.ts**

```typescript
import { connect } from 'net'

/**
 * Returns the Codex injection socket path for the given PID.
 * Defaults to process.ppid (the Codex process that spawned this MCP server).
 */
export function findCodexSocketPath(pid?: number): string {
  return `/tmp/codex-inject-${pid ?? process.ppid}.sock`
}

/**
 * Send a text message to a running Codex instance via its Unix domain socket.
 * Resolves when written, rejects on connection error.
 */
export function injectMessage(socketPath: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => {
      const payload = JSON.stringify({ text }) + '\n'
      socket.write(payload, err => {
        socket.end()
        if (err) reject(err)
        else resolve()
      })
    })
    socket.on('error', reject)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/codex-inject.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/codex-inject.ts tests/codex-inject.test.ts
git commit -m "feat: Codex Unix socket injection"
```

---

### Task 6: Nostr Client

**Files:**
- Create: `src/nostr.ts`
- Create: `tests/nostr.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/nostr.test.ts
import { test, expect } from 'bun:test'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { NostrClient } from '../src/nostr.ts'
import type { InboundMessage } from '../src/types.ts'

function makeClient(contactNpubs: string[] = []) {
  const privkey = generateSecretKey()
  const pubkeyHex = getPublicKey(privkey)
  const messages: InboundMessage[] = []
  const client = new NostrClient({
    npub: nip19.npubEncode(pubkeyHex),
    nsec: nip19.nsecEncode(privkey),
    relayUrls: [],
    contacts: contactNpubs.map(npub => ({ npub, name: 'Test' })),
    onMessage: msg => messages.push(msg),
  })
  return { client, npub: nip19.npubEncode(pubkeyHex), pubkeyHex, messages }
}

test('NIP-17 encrypt/decrypt roundtrip', () => {
  const sender = makeClient()
  const recipient = makeClient([sender.npub])

  const giftWrap = sender.client.createGiftWrap(recipient.pubkeyHex, 'hello world')
  const { senderNpub, content } = recipient.client.unwrapGiftWrap(giftWrap)

  expect(content).toBe('hello world')
  expect(senderNpub).toBe(sender.npub)
})

test('unwrapGiftWrap throws on tampered content', () => {
  const sender = makeClient()
  const recipient = makeClient([sender.npub])

  const giftWrap = sender.client.createGiftWrap(recipient.pubkeyHex, 'hello')
  giftWrap.content = 'tampered_content'

  expect(() => recipient.client.unwrapGiftWrap(giftWrap)).toThrow()
})

test('message from allowed contact is queued', () => {
  const sender = makeClient()
  const recipient = makeClient([sender.npub])

  const giftWrap = sender.client.createGiftWrap(recipient.pubkeyHex, 'hi')
  ;(recipient.client as any).handleEvent(giftWrap)

  expect(recipient.messages).toHaveLength(1)
  expect(recipient.messages[0].content).toBe('hi')
  expect(recipient.messages[0].from_npub).toBe(sender.npub)
  expect(recipient.messages[0].from_name).toBe('Test')
})

test('message from unknown sender is dropped', () => {
  const sender = makeClient()
  const recipient = makeClient([])

  const giftWrap = sender.client.createGiftWrap(recipient.pubkeyHex, 'hi')
  ;(recipient.client as any).handleEvent(giftWrap)

  expect(recipient.messages).toHaveLength(0)
})

test('malformed event is silently dropped', () => {
  const recipient = makeClient(['npub1alice'])
  const badEvent = { pubkey: 'badhex', content: 'garbage', tags: [] }

  expect(() => (recipient.client as any).handleEvent(badEvent)).not.toThrow()
  expect(recipient.messages).toHaveLength(0)
})

test('getRelayStatuses returns empty array with no relays', () => {
  const { client } = makeClient()
  expect(client.getRelayStatuses()).toEqual([])
})

test('updateContacts allows new sender after update', () => {
  const sender = makeClient()
  const recipient = makeClient([])

  const giftWrap = sender.client.createGiftWrap(recipient.pubkeyHex, 'hi')

  ;(recipient.client as any).handleEvent(giftWrap)
  expect(recipient.messages).toHaveLength(0)

  recipient.client.updateContacts([{ npub: sender.npub, name: 'Sender' }])
  ;(recipient.client as any).handleEvent(giftWrap)
  expect(recipient.messages).toHaveLength(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/nostr.test.ts
```

Expected: FAIL with "Cannot find module '../src/nostr.ts'"

- [ ] **Step 3: Create src/nostr.ts**

```typescript
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import { nip19, nip44 } from 'nostr-tools'
import { Relay } from 'nostr-tools'
import { isAllowed } from './contacts.ts'
import { decodeNsec, decodeNpub } from './keys.ts'
import type { Contact, InboundMessage, RelayStatus } from './types.ts'

export interface NostrClientOptions {
  npub: string
  nsec: string
  relayUrls: string[]
  contacts: Contact[]
  onMessage: (msg: InboundMessage) => void
}

export class NostrClient {
  private privkey: Uint8Array
  private pubkeyHex: string
  private npub: string
  private relays: Map<string, { relay: Relay | null; connected: boolean }>
  private contacts: Contact[]
  private onMessage: (msg: InboundMessage) => void
  private seenEventIds = new Set<string>()
  private readonly startupTime: number = Math.floor(Date.now() / 1000)

  constructor(opts: NostrClientOptions) {
    this.privkey = decodeNsec(opts.nsec)
    this.pubkeyHex = decodeNpub(opts.npub)
    this.npub = opts.npub
    this.contacts = opts.contacts
    this.onMessage = opts.onMessage
    this.relays = new Map(opts.relayUrls.map(url => [url, { relay: null, connected: false }]))
  }

  async connect(): Promise<void> {
    await Promise.allSettled([...this.relays.keys()].map(url => this.connectRelay(url)))
  }

  private async connectRelay(url: string): Promise<void> {
    try {
      const relay = await Relay.connect(url)
      this.relays.set(url, { relay, connected: true })
      relay.subscribe([{ kinds: [1059], '#p': [this.pubkeyHex], since: this.startupTime }], {
        onevent: (event: any) => this.handleEvent(event),
      })
      relay.onclose = () => {
        this.relays.set(url, { relay: null, connected: false })
        setTimeout(() => this.connectRelay(url), 5000)
      }
    } catch {
      this.relays.set(url, { relay: null, connected: false })
    }
  }

  private handleEvent(event: any): void {
    if (this.seenEventIds.has(event.id)) return
    this.seenEventIds.add(event.id)
    try {
      const { senderNpub, content } = this.unwrapGiftWrap(event)
      if (!isAllowed(this.contacts, senderNpub)) return
      const contact = this.contacts.find(c => c.npub === senderNpub)
      this.onMessage({
        from_npub: senderNpub,
        from_name: contact?.name ?? null,
        content,
        received_at: new Date().toISOString(),
      })
    } catch (e) {
      process.stderr.write(`[codex_a2a_chat] handleEvent dropped event: ${e}\n`)
    }
  }

  async send(toNpub: string, content: string): Promise<{ ok: boolean; sent: number; total: number }> {
    const toPubkeyHex = decodeNpub(toNpub)
    const giftWrap = this.createGiftWrap(toPubkeyHex, content)
    const connected = [...this.relays.values()].filter(r => r.connected && r.relay)
    const results = await Promise.allSettled(connected.map(r => r.relay!.publish(giftWrap)))
    const sent = results.filter(r => r.status === 'fulfilled').length
    return { ok: sent > 0, sent, total: connected.length }
  }

  updateContacts(contacts: Contact[]): void {
    this.contacts = contacts
  }

  getRelayStatuses(): RelayStatus[] {
    return [...this.relays.entries()].map(([url, { connected }]) => ({ url, connected }))
  }

  createGiftWrap(toPubkeyHex: string, content: string): any {
    const rumor = {
      kind: 14,
      content,
      tags: [['p', toPubkeyHex]],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: this.pubkeyHex,
    }
    const convKey1 = nip44.getConversationKey(this.privkey, toPubkeyHex)
    const seal = finalizeEvent(
      { kind: 13, content: nip44.encrypt(JSON.stringify(rumor), convKey1), tags: [], created_at: Math.floor(Date.now() / 1000) },
      this.privkey
    )
    const ephemeralKey = generateSecretKey()
    const convKey2 = nip44.getConversationKey(ephemeralKey, toPubkeyHex)
    return finalizeEvent(
      { kind: 1059, content: nip44.encrypt(JSON.stringify(seal), convKey2), tags: [['p', toPubkeyHex]], created_at: Math.floor(Date.now() / 1000) },
      ephemeralKey
    )
  }

  unwrapGiftWrap(giftWrap: any): { senderNpub: string; content: string } {
    const convKey1 = nip44.getConversationKey(this.privkey, giftWrap.pubkey)
    const seal = JSON.parse(nip44.decrypt(giftWrap.content, convKey1))
    const convKey2 = nip44.getConversationKey(this.privkey, seal.pubkey)
    const rumor = JSON.parse(nip44.decrypt(seal.content, convKey2))
    return { senderNpub: nip19.npubEncode(rumor.pubkey), content: rumor.content }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/nostr.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/nostr.ts tests/nostr.test.ts
git commit -m "feat: Nostr client with NIP-17 encryption"
```

---

### Task 7: MCP Server Entry Point

**Files:**
- Create: `src/index.ts`

No isolated unit tests for `index.ts` — it wires together already-tested modules. Verify manually at end of task.

- [ ] **Step 1: Create src/index.ts**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadOrGenerateKey } from './keys.ts'
import { loadContacts, addContact } from './contacts.ts'
import { NostrClient } from './nostr.ts'
import { findCodexSocketPath, injectMessage } from './codex-inject.ts'
import type { InboundMessage } from './types.ts'

// --- Parse CLI args ---
const widx = process.argv.indexOf('--workdir')
if (widx === -1 || !process.argv[widx + 1]) {
  process.stderr.write('Usage: bun run src/index.ts --workdir <path> [--codex-pid <pid>]\n')
  process.exit(1)
}
const workdir = process.argv[widx + 1]

const pidIdx = process.argv.indexOf('--codex-pid')
const codexPid = pidIdx !== -1 && process.argv[pidIdx + 1]
  ? parseInt(process.argv[pidIdx + 1], 10)
  : undefined

// Socket path: --codex-pid → process.ppid
const socketPath = findCodexSocketPath(codexPid)

// --- Load .env from workdir ---
const envPath = join(workdir, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/)
    if (m) process.env[m[1]] = m[2].trim()
  }
}

const relayUrls = (process.env.NOSTR_RELAYS ?? 'wss://relay.damus.io,wss://relay.nostr.band')
  .split(',').map(s => s.trim()).filter(Boolean)

// --- Bootstrap ---
const keypair = loadOrGenerateKey(workdir)
let contacts = loadContacts(workdir)
const messageQueue: InboundMessage[] = []

const nostr = new NostrClient({
  npub: keypair.npub,
  nsec: keypair.nsec,
  relayUrls,
  contacts,
  onMessage: async (msg) => {
    messageQueue.push(msg)
    // Attempt socket injection; silently skip if socket unavailable
    const text = `[P2P from ${msg.from_name ?? msg.from_npub}]\n${msg.content}`
    try {
      await injectMessage(socketPath, text)
    } catch {
      // Socket not available — message remains in queue for check_messages
    }
  },
})

await nostr.connect()

// --- MCP Server ---
const server = new Server(
  { name: 'codex_a2a_chat', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_message',
      description: 'Send an encrypted NIP-17 DM to a contact',
      inputSchema: {
        type: 'object',
        properties: {
          to_npub: { type: 'string', description: 'Recipient npub (bech32)' },
          content: { type: 'string', description: 'Message text' },
        },
        required: ['to_npub', 'content'],
      },
    },
    {
      name: 'check_messages',
      description: 'Return and clear all queued inbound messages',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'add_contact',
      description: 'Add a contact to contact.json (allows their messages in)',
      inputSchema: {
        type: 'object',
        properties: {
          npub: { type: 'string', description: 'Contact npub (bech32)' },
          name: { type: 'string', description: 'Display name' },
        },
        required: ['npub', 'name'],
      },
    },
    {
      name: 'list_contacts',
      description: 'List all contacts in contact.json',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'my_npub',
      description: "Return this instance's own npub",
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'status',
      description: 'Show relay status, socket info, npub, and message queue depth',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params
  const text = (s: unknown) => ({ content: [{ type: 'text' as const, text: String(s) }] })

  switch (name) {
    case 'send_message': {
      if (!args.to_npub || typeof args.to_npub !== 'string') return text('Error: to_npub is required.')
      if (!args.content || typeof args.content !== 'string') return text('Error: content is required.')
      const result = await nostr.send(args.to_npub, args.content)
      if (!result.ok) return text(`Failed to send: no relays available (${result.total} configured, 0 accepted).`)
      return text(`Message sent (${result.sent}/${result.total} relays).`)
    }

    case 'check_messages': {
      const msgs = messageQueue.splice(0)
      return text(msgs.length ? JSON.stringify(msgs, null, 2) : 'No new messages.')
    }

    case 'add_contact':
      if (!args.npub || typeof args.npub !== 'string') return text('Error: npub is required.')
      if (!args.name || typeof args.name !== 'string') return text('Error: name is required.')
      contacts = addContact(workdir, args.npub, args.name)
      nostr.updateContacts(contacts)
      return text(`Contact "${args.name}" added.`)

    case 'list_contacts':
      return text(contacts.length ? JSON.stringify(contacts, null, 2) : 'No contacts.')

    case 'my_npub':
      return text(keypair.npub)

    case 'status': {
      let socketReachable = false
      try {
        await injectMessage(socketPath, '')
        socketReachable = true
      } catch {
        socketReachable = false
      }
      return text(JSON.stringify({
        npub: keypair.npub,
        workdir,
        relays: nostr.getRelayStatuses(),
        contacts: contacts.length,
        queued_messages: messageQueue.length,
        socket: { path: socketPath, reachable: socketReachable },
      }, null, 2))
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
bun test
```

Expected: All tests PASS (keys: 7, contacts: 7, codex-inject: 4, nostr: 7 = 25 total)

- [ ] **Step 3: Smoke test — verify server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun run src/index.ts --workdir /tmp/codex_test 2>/dev/null
```

Expected: JSON response listing 6 tools (`send_message`, `check_messages`, `add_contact`, `list_contacts`, `my_npub`, `status`)

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: MCP server with Nostr messaging and Codex socket injection"
```

---

### Task 8: Push to Remote

- [ ] **Step 1: Run full test suite one final time**

```bash
bun test
```

Expected: 25 tests PASS, 0 failures

- [ ] **Step 2: Push to remote**

```bash
git push origin master
```

Expected: All commits pushed to `https://github.com/nicholasyangyang/codex_a2a_chat`
