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
