/**
 * Native modal handler — Click confirm/cancel on wx.showModal dialogs
 *
 * Wraps miniprogram-automator's Native API:
 *   native().confirmModal() — click the "confirm" button
 *   native().cancelModal()  — click the "cancel" button
 *
 * These are **system-level** operations sent over the WebSocket as
 * Tool.native { method: "confirmModal"|"cancelModal" }.
 * They only work when a real wx.showModal is visible — they do not
 * interact with mocked showModal calls.
 */

import type { SessionState } from '../../../types.js'
import { withTimeout, getTimeout, DEFAULT_TIMEOUTS } from '../../../runtime/timeout/timeout.js'
import { withSessionLock } from '../../../runtime/concurrency/mutex.js'

/**
 * Native modal operation result
 */
export interface NativeModalResult {
  success: boolean
  message: string
}

// ── Helpers ───────────────────────────────────────────────────

/** Ensure native() is callable (SDK version gate) */
function getNative(session: SessionState): any {
  const mp = session.miniProgram
  if (!mp) {
    throw new Error(
      'MiniProgram not connected. Call miniprogram_launch or miniprogram_connect first.'
    )
  }
  if (typeof mp.native !== 'function') {
    throw new Error(
      'Native API not available — miniprogram-automator SDK may be too old. ' +
        'Requires miniprogram-automator >= 0.10.0.'
    )
  }
  return mp.native()
}

/** Shared execution path for both confirm and cancel */
async function executeNativeModal(
  session: SessionState,
  action: 'confirm' | 'cancel',
  label: string
): Promise<NativeModalResult> {
  return withSessionLock(session.sessionId, async () => {
    const native = getNative(session)
    const timeoutMs = getTimeout(session.config?.timeout, DEFAULT_TIMEOUTS.nativeModal)
    const logger = session.logger
    const methodName = action === 'confirm' ? 'confirmModal' : 'cancelModal'

    try {
      logger?.info(`Clicking native modal ${action} button`)
      await withTimeout(
        action === 'confirm' ? native.confirmModal() : native.cancelModal(),
        timeoutMs,
        `native ${methodName}`
      )
      return {
        success: true,
        message: `Native modal "${label}" button clicked successfully.`,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger?.error(`native ${methodName} failed`, { error: errorMessage })
      throw new Error(`${methodName} failed: ${errorMessage}`)
    }
  })
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Click the "confirm" button on a native wx.showModal dialog.
 *
 * Preconditions:
 * - MiniProgram must be connected
 * - A wx.showModal dialog must be visible (typically triggered by a
 *   prior element tap or page action)
 *
 * If no modal is present the DevTools server will reject the call;
 * the error is surfaced as a thrown Error.
 */
export async function confirmModal(session: SessionState): Promise<NativeModalResult> {
  return executeNativeModal(session, 'confirm', 'OK')
}

/**
 * Click the "cancel" button on a native wx.showModal dialog.
 *
 * Same preconditions as confirmModal — the dialog must be visible.
 */
export async function cancelModal(session: SessionState): Promise<NativeModalResult> {
  return executeNativeModal(session, 'cancel', 'Cancel')
}
