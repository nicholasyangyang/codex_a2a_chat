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

// Valid npub format: npub1 prefix + 57 base58 characters = 63 total
const VALID_NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'

test('returns empty array when contact.json missing', () => {
  expect(loadContacts(tmpDir)).toEqual([])
})

test('loads contacts from contact.json', () => {
  writeFileSync(
    join(tmpDir, 'contact.json'),
    JSON.stringify({ contacts: [{ npub: VALID_NPUB, name: 'Alice' }] })
  )
  expect(loadContacts(tmpDir)).toEqual([{ npub: VALID_NPUB, name: 'Alice' }])
})

test('addContact writes to contact.json', () => {
  addContact(tmpDir, VALID_NPUB, 'Alice')
  expect(loadContacts(tmpDir)).toEqual([{ npub: VALID_NPUB, name: 'Alice' }])
})

test('addContact does not duplicate existing npub', () => {
  addContact(tmpDir, VALID_NPUB, 'Alice')
  addContact(tmpDir, VALID_NPUB, 'Alice2')
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

test('loadContacts throws on malformed JSON', () => {
  writeFileSync(join(tmpDir, 'contact.json'), '{ invalid json }')
  expect(() => loadContacts(tmpDir)).toThrow()
})
