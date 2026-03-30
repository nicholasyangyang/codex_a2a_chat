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
