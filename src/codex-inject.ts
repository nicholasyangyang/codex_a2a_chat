import { connect } from 'net'

/**
 * Returns the Codex injection socket path for the given PID.
 * Defaults to process.ppid (the Codex process that spawned this MCP server).
 */
export function findCodexSocketPath(pid?: number): string {
  return `/tmp/codex-inject-${pid ?? process.ppid}.sock`
}

/**
 * Send a text message to a running Codex instance via its Unix domain socket.
 * Resolves when written, rejects on connection error.
 */
export function injectMessage(socketPath: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => {
      const payload = JSON.stringify({ text }) + '\n'
      socket.write(payload, err => {
        socket.end()
        if (err) reject(err)
        else resolve()
      })
    })
    socket.on('error', reject)
  })
}
