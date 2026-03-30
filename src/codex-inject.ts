import { connect } from 'net'

/**
 * Returns the Codex injection socket path for the given PID.
 * Defaults to process.ppid (the Codex process that spawned this MCP server).
 *
 * @warning process.ppid is used verbatim as a path component. On shared hosts or
 * multi-tenant environments, this could route messages to unintended sockets.
 * Ensure ppid uniquely identifies the target Codex process.
 */
export function findCodexSocketPath(pid?: number): string {
  return `/tmp/codex-inject-${pid ?? process.ppid}.sock`
}

/**
 * Send a text message to a running Codex instance via its Unix domain socket.
 * Resolves when written, rejects on connection error or after 5s timeout.
 */
export function injectMessage(socketPath: string, text: unknown): Promise<void> {
  if (typeof text !== 'string') {
    throw new TypeError(`text must be a string, got ${typeof text}`)
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error(`connect() timed out after 5000ms: ${socketPath}`))
    }, 5000)

    const socket = connect(socketPath, () => {
      clearTimeout(timeout)
      const payload = JSON.stringify({ text }) + '\n'
      socket.write(payload, err => {
        socket.end()
        if (err) reject(err)
        else resolve()
      })
    })
    socket.on('error', err => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}
