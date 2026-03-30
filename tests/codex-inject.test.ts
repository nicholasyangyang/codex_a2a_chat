import { test, expect } from 'bun:test'
import { createServer } from 'net'
import { unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
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
  const sockPath = `${tmpdir()}/codex-inject-test-${randomUUID()}.sock`
  if (existsSync(sockPath)) unlinkSync(sockPath)

  const received: string[] = []
  const server = createServer(socket => {
    socket.on('data', data => received.push(data.toString()))
  })

  await new Promise<void>(resolve => server.listen(sockPath, resolve))

  try {
    await injectMessage(sockPath, 'hello from test')
    // Wait until the server has received the data instead of a fixed sleep
    await new Promise<void>(resolve => {
      const check = () => {
        if (received.length > 0) resolve()
        else setTimeout(check, 5)
      }
      check()
    })
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
