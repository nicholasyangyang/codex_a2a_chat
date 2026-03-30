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
