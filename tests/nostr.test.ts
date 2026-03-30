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

test('send with zero relays returns ok false', async () => {
  const { client } = makeClient()
  const result = await client.send(makeClient().npub, 'hello')
  expect(result.ok).toBe(false)
  expect(result.sent).toBe(0)
  expect(result.total).toBe(0)
})

test('unwrapGiftWrap throws when gift wrap p tag does not match recipient', () => {
  const sender = makeClient()
  const recipient = makeClient([sender.npub])
  const anotherClient = makeClient()

  // gift wrap addressed to `recipient` from `sender`
  const giftWrap = sender.client.createGiftWrap(recipient.pubkeyHex, 'secret')
  // try to unwrap it as `anotherClient` (p tag won't match)
  expect(() => anotherClient.client.unwrapGiftWrap(giftWrap)).toThrow('Gift wrap not addressed to this client')
})
