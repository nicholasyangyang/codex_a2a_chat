import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Contact, ContactList } from './types.ts'

export function loadContacts(workdir: string): Contact[] {
  const path = join(workdir, 'contact.json')
  if (!existsSync(path)) return []
  let data: ContactList
  try {
    data = JSON.parse(readFileSync(path, 'utf-8')) as ContactList
  } catch (err) {
    throw new Error(`Failed to load contact.json at ${path}: ${err instanceof Error ? err.message : err}`)
  }
  return data.contacts ?? []
}

export function addContact(workdir: string, npub: string, name: string): Contact[] {
  if (!npub.startsWith('npub1') || npub.length < 50) throw new Error('Invalid npub format')
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
