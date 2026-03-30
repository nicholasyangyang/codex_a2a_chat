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
