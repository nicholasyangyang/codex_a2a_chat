import { generateSecretKey, finalizeEvent } from 'nostr-tools'
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
  private seenEventIds = new Map<string, number>()
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
    const backoff = ((this.relays.get(url) as any)?._backoff) ?? 5000
    try {
      const relay = await Relay.connect(url)
      this.relays.set(url, { relay, connected: true })
      relay.subscribe([{ kinds: [1059], '#p': [this.pubkeyHex], since: this.startupTime }], {
        onevent: (event: any) => this.handleEvent(event),
      })
      relay.onclose = () => {
        this.relays.set(url, { relay: null, connected: false })
        setTimeout(() => this.connectRelay(url), backoff)
        this.scheduleBackoffReset(url, backoff)
      }
    } catch {
      this.relays.set(url, { relay: null, connected: false })
      setTimeout(() => this.connectRelay(url), backoff)
      this.scheduleBackoffReset(url, backoff)
    }
  }

  private scheduleBackoffReset(url: string, delay: number): void {
    const next = Math.min(delay * 2, 5 * 60 * 1000)
    const entry = this.relays.get(url)
    if (entry) (entry as any)._backoff = next
  }

  private handleEvent(event: any): void {
    if (this.seenEventIds.has(event.id)) return
    this.seenEventIds.set(event.id, Date.now())
    const cutoff = Date.now() - 10 * 60 * 1000
    for (const [id, ts] of this.seenEventIds) {
      if (ts < cutoff) this.seenEventIds.delete(id)
    }
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
    this.seenEventIds.clear()
  }

  getRelayStatuses(): RelayStatus[] {
    return [...this.relays.entries()].map(([url, { connected }]) => ({ url, connected }))
  }

  /** Close all active relay connections. */
  close(): void {
    for (const { relay } of this.relays.values()) {
      try { relay?.close() } catch { /* ignore */ }
    }
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
    // NIP-17: seal.pubkey must be sender's identity pubkey, not ephemeral key
    ;(seal as any).pubkey = this.pubkeyHex
    const ephemeralKey = generateSecretKey()
    const convKey2 = nip44.getConversationKey(ephemeralKey, toPubkeyHex)
    return finalizeEvent(
      { kind: 1059, content: nip44.encrypt(JSON.stringify(seal), convKey2), tags: [['p', toPubkeyHex]], created_at: Math.floor(Date.now() / 1000) },
      ephemeralKey
    )
  }

  unwrapGiftWrap(giftWrap: any): { senderNpub: string; content: string } {
    const recipientTag = giftWrap.tags?.find((t: any) => t[0] === 'p')?.[1]
    if (recipientTag !== this.pubkeyHex) throw new Error('Gift wrap not addressed to this client')
    const convKey1 = nip44.getConversationKey(this.privkey, giftWrap.pubkey)
    const seal = JSON.parse(nip44.decrypt(giftWrap.content, convKey1))
    const convKey2 = nip44.getConversationKey(this.privkey, seal.pubkey)
    const rumor = JSON.parse(nip44.decrypt(seal.content, convKey2))
    return { senderNpub: nip19.npubEncode(rumor.pubkey), content: rumor.content }
  }
}
