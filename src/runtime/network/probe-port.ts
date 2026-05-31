/**
 * TCP port reachability probe.
 *
 * Used by connect and launch handlers to fail fast when DevTools isn't listening,
 * instead of waiting for the full WebSocket timeout.
 */

import net from 'node:net'

/**
 * Probe whether a TCP port is reachable.
 * Resolves true immediately on successful connect, false on timeout/error.
 *
 * @param port - Port number to probe
 * @param timeoutMs - Timeout in milliseconds
 */
export function probePort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.on('connect', () => finish(true))
    socket.on('timeout', () => finish(false))
    socket.on('error', () => finish(false))

    socket.connect(port, '127.0.0.1')
  })
}
