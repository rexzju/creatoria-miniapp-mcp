/**
 * Connect handler - Connects to an already running WeChat DevTools instance
 */

import automator from 'miniprogram-automator'
import type { SessionState } from '../../../types.js'
import { disconnect } from './disconnect.js'
import { withTimeout, getTimeout, DEFAULT_TIMEOUTS } from '../../../runtime/timeout/timeout.js'
import { withRetry, RetryPredicates } from '../../../runtime/retry/retry.js'
import { probePort } from '../../../runtime/network/probe-port.js'

/**
 * Default automation port for WeChat DevTools (matches SDK internal default)
 */
const DEFAULT_PORT = 9420

/**
 * Connect input arguments
 */
export interface ConnectArgs {
  port?: number
}

/**
 * Connect result
 */
export interface ConnectResult {
  success: boolean
  message: string
  port?: number
}

/**
 * Connect to an already running WeChat DevTools instance
 * Note: The port must be configured in WeChat DevTools settings before connecting
 */
export async function connect(
  session: SessionState,
  args: ConnectArgs = {}
): Promise<ConnectResult> {
  const { port } = args
  const logger = session.logger

  try {
    logger?.info('Connecting to existing DevTools instance', { port })

    // Check if already connected
    if (session.miniProgram) {
      logger?.warn('MiniProgram already connected, disconnecting first')
      await disconnect(session)
    }

    // TCP port reachability probe — fail fast when DevTools isn't listening.
    // Skip in Jest (JEST_WORKER_ID is auto-injected) and when explicitly disabled.
    if (!process.env.JEST_WORKER_ID && process.env.MCP_SKIP_PORT_PROBE !== '1') {
      const effectivePort = port ?? DEFAULT_PORT
      logger?.debug('Probing automation port for reachability', { port: effectivePort })
      const reachable = await probePort(effectivePort, 3000)
      if (!reachable) {
        throw new Error(
          `Cannot reach automation port ${effectivePort}. Is WeChat DevTools running with automation enabled (Settings → Security → CLI/HTTP)?`
        )
      }
    }

    // Build wsEndpoint. SDK requires a non-empty string; falling back to the
    // default automation port avoids `new ws(undefined)`. Use 127.0.0.1 (not
    // localhost) to match the SDK's own launch path and avoid IPv6 ::1 misroute.
    const wsEndpoint = `ws://127.0.0.1:${port ?? DEFAULT_PORT}`

    // Resolve connect timeout (config → default 30s). The SDK's Connection.create
    // wraps `new ws()` with NO connection timeout, so a reachable-but-unresponsive
    // DevTools (automation disabled) would hang forever without this guard.
    const timeoutMs = getTimeout(session.config?.connectTimeout, DEFAULT_TIMEOUTS.connect)

    // Connect with timeout + single retry on transient connection errors.
    // Unlike screenshot (which uses onConnectionError — no timeout retry), connect
    // retries on timeout too. Reason: when the port just opened, the WebSocket
    // handshake may not be ready yet; a brief timeout retry is harmless here because
    // there is no in-flight SDK request consuming WebSocket bandwidth.
    const miniProgram = await withRetry(
      () =>
        withTimeout(
          automator.connect({ wsEndpoint } as any),
          timeoutMs,
          'Connect to DevTools'
        ),
      {
        maxRetries: 1,
        delayMs: 1000,
        shouldRetry: RetryPredicates.onTransientError,
        onRetry: (attempt, error, delay) => {
          logger?.warn(`Connect retry attempt ${attempt}`, {
            error: error.message,
            nextDelayMs: delay,
          })
        },
      }
    )

    // Store in session (use 'as any' to bypass type incompatibility between official types and our interface)
    session.miniProgram = miniProgram as any
    if (port) {
      session.config = {
        ...session.config,
        port,
      }
    }

    logger?.info('Connected to DevTools successfully', { port })

    return {
      success: true,
      message: port
        ? `Connected to DevTools on port ${port}`
        : 'Connected to DevTools successfully',
      port,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger?.error('Failed to connect to DevTools', {
      error: errorMessage,
      port,
    })

    throw new Error(`Failed to connect to DevTools: ${errorMessage}`)
  }
}
