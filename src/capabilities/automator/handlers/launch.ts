/**
 * Launch handler - Launches WeChat DevTools and connects to miniprogram
 */

import automator from 'miniprogram-automator'
import type { SessionState } from '../../../types.js'
import { disconnect } from './disconnect.js'
import { withTimeout, getTimeout, DEFAULT_TIMEOUTS } from '../../../runtime/timeout/timeout.js'
import { probePort } from '../../../runtime/network/probe-port.js'

/**
 * Default automation port for WeChat DevTools
 */
const DEFAULT_PORT = 9420

/**
 * Default CLI path for macOS
 */
const DEFAULT_CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

/**
 * Launch input arguments
 */
export interface LaunchArgs {
  projectPath: string
  cliPath?: string
  port?: number
  /**
   * Reuse an already-running DevTools on the port via connect (≈10ms) instead of
   * spawning a new instance (≈13s). Defaults to true. Set false to force a fresh launch.
   */
  reuseExisting?: boolean
}

/**
 * Launch result
 */
export interface LaunchResult {
  success: boolean
  message: string
  port?: number
}

/**
 * Launch WeChat DevTools and connect to miniprogram
 */
export async function launch(session: SessionState, args: LaunchArgs): Promise<LaunchResult> {
  const { projectPath, cliPath = DEFAULT_CLI_PATH, port = DEFAULT_PORT, reuseExisting = true } = args
  const logger = session.logger

  try {
    logger?.info('Launching miniprogram', {
      projectPath,
      cliPath,
      port,
      reuseExisting,
    })

    // Check if already connected
    if (session.miniProgram) {
      logger?.warn('MiniProgram already connected, disconnecting first')
      await disconnect(session)
    }

    const connectTimeoutMs = getTimeout(session.config?.connectTimeout, DEFAULT_TIMEOUTS.connect)

    // Fast path: reuse an already-running DevTools on this port.
    // Real-world data: connect ≈10ms vs full launch ≈13s (SDK spawns the process,
    // polls, then sleeps a hardcoded 5s). Skip the spawn when a service is already up.
    if (reuseExisting && !process.env.JEST_WORKER_ID) {
      const alreadyRunning = await probePort(port, 1000)
      if (alreadyRunning) {
        // The running DevTools may host a different project than `projectPath`.
        // We connect to whatever is already on the port; surface that in the log.
        logger?.warn(
          'Automation port already listening, reusing via connect (fast path). The running instance may host a different project than the requested projectPath; pass reuseExisting=false to force a fresh launch.',
          { port, requestedProjectPath: projectPath }
        )
        const miniProgram = await withTimeout(
          automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` } as any),
          connectTimeoutMs,
          'Connect to existing DevTools'
        )
        session.miniProgram = miniProgram as any
        session.config = { ...session.config, projectPath, cliPath, port }
        logger?.info('MiniProgram connected via fast path', { port })
        return {
          success: true,
          message: `Reused running DevTools on port ${port} (fast path, may host a different project than ${projectPath})`,
          port,
        }
      }
    }

    // Resolve launch timeout (config → default 60s). The SDK uses `timeout` as the
    // total poll budget in waitUntil, but its internal poll awaits `new ws()` which
    // has no timeout — a reachable-but-unresponsive port can hang the SDK past its
    // own budget. The outer withTimeout is the real guard against that.
    const timeoutMs = getTimeout(session.config?.launchTimeout, DEFAULT_TIMEOUTS.launch)

    // Launch with outer timeout protection
    const miniProgram = await withTimeout(
      automator.launch({
        projectPath,
        cliPath,
        port,
        timeout: timeoutMs,
      }),
      timeoutMs,
      'Launch miniprogram'
    )

    // Store in session (use 'as any' to bypass type incompatibility between official types and our interface)
    session.miniProgram = miniProgram as any
    session.config = {
      ...session.config,
      projectPath,
      cliPath,
      port,
    }

    logger?.info('MiniProgram launched successfully', { port })

    return {
      success: true,
      message: `MiniProgram launched successfully on port ${port}`,
      port,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger?.error('Failed to launch miniprogram', {
      error: errorMessage,
      projectPath,
    })

    throw new Error(`Failed to launch miniprogram: ${errorMessage}`)
  }
}
