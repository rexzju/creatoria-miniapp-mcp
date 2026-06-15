/**
 * Screenshot handler - Capture full-page mini program screenshots
 *
 * Automatically detects scrollable content (scroll-view or page-level scroll)
 * and stitches top/bottom screenshots into a single full-page image.
 * When no scrollable content is found, falls back to a single viewport screenshot.
 */

import { join } from 'path'
import { setTimeout as sleep } from 'timers/promises'
import type { SessionState } from '../../../types.js'
import { withTimeout, getTimeout, DEFAULT_TIMEOUTS } from '../../../runtime/timeout/timeout.js'
import { withRetry, RetryPredicates } from '../../../runtime/retry/retry.js'
import { withSessionLock } from '../../../runtime/concurrency/mutex.js'

/**
 * Screenshot input arguments
 */
export interface ScreenshotArgs {
  filename?: string
}

/**
 * Screenshot result
 */
export interface ScreenshotResult {
  success: boolean
  message: string
  path?: string
}

/**
 * Describes a scrollable region and how to scroll it.
 */
interface ScrollInfo {
  type: 'scroll-view' | 'page-level'
  scrollHeight: number
  visibleHeight: number
  maxScroll: number
  /** Scroll to top (scrollTop=0). */
  scrollToTop: () => Promise<void>
  /** Scroll to bottom (scrollTop=maxScroll). */
  scrollToBottom: () => Promise<void>
}

/**
 * Take a screenshot of the mini program.
 * Automatically detects scrollable content and captures the full page.
 */
export async function screenshot(
  session: SessionState,
  args: ScreenshotArgs = {}
): Promise<ScreenshotResult> {
  // Serialize against ALL SDK operations on this session (shared single WebSocket).
  return withSessionLock(session.sessionId, () => screenshotImpl(session, args))
}

/**
 * Detect scrollable content — first checks for a <scroll-view> element, then
 * falls back to page-level scrolling (document scroll).
 *
 * Returns null when no scrollable content > visible area is found.
 *
 * A MIN_SCROLL_THRESHOLD (in CSS pixels) is applied so pages whose scrollable
 * area is only slightly larger than the viewport are treated as non-scrollable;
 * stitching two near-identical screenshots adds no value.
 */
const MIN_SCROLL_THRESHOLD = 60
async function detectScrollableContent(
  session: SessionState
): Promise<ScrollInfo | null> {
  const mp = session.miniProgram!
  const page = await mp.currentPage()
  if (!page) return null

  // ── Strategy 1: <scroll-view> element ──────────────────────────────────
  try {
    const scrollViews = await page.$$('scroll-view')
    if (scrollViews && scrollViews.length > 0) {
      const sv = (scrollViews[0] as any)
      const scrollHeight: number = await sv.scrollHeight()
      const { height: visibleHeight } = await sv.size()

      if (scrollHeight > visibleHeight) {
        const maxScroll = scrollHeight - visibleHeight
        if (maxScroll < MIN_SCROLL_THRESHOLD) {
          session.logger?.info('scroll-view scroll too small, skipping stitch', {
            maxScroll,
            threshold: MIN_SCROLL_THRESHOLD,
          })
          return null
        }
        session.logger?.info('Scrollable <scroll-view> detected', {
          scrollHeight,
          visibleHeight,
          maxScroll,
        })
        return {
          type: 'scroll-view',
          scrollHeight,
          visibleHeight,
          maxScroll,
          scrollToTop: () => sv.scrollTo(0, 0),
          scrollToBottom: () => sv.scrollTo(0, maxScroll),
        }
      }
    }
  } catch (error) {
    session.logger?.warn('scroll-view detection error', {
      error: String(error),
    })
  }

  // ── Strategy 2: Page-level (document) scroll ──────────────────────────
  try {
    const { height: pageHeight } = await page.size()
    // window.innerHeight gives the logical viewport height in the mini
    // program simulator.  Only proceed when it produces a reasonable value.
    // Use a function literal (as a string) so TypeScript in Node context
    // doesn't flag `window` as an undefined global.
    const fnBody = 'return window.innerHeight'
    const vpHeight: number = await mp.evaluate(new Function(fnBody))

    if (
      typeof vpHeight === 'number' &&
      vpHeight > 0 &&
      pageHeight > vpHeight
    ) {
      const maxScroll = pageHeight - vpHeight
      if (maxScroll < MIN_SCROLL_THRESHOLD) {
        session.logger?.info('page scroll too small, skipping stitch', {
          maxScroll,
          threshold: MIN_SCROLL_THRESHOLD,
        })
        return null
      }
      session.logger?.info('Page-level scroll detected', {
        pageHeight,
        viewportHeight: vpHeight,
        maxScroll,
      })
      return {
        type: 'page-level',
        scrollHeight: pageHeight,
        visibleHeight: vpHeight,
        maxScroll,
        scrollToTop: () => (mp as any).pageScrollTo(0),
        scrollToBottom: () => (mp as any).pageScrollTo(maxScroll),
      }
    }
  } catch (error) {
    session.logger?.warn('page-scroll detection error', {
      error: String(error),
    })
  }

  return null
}

/**
 * Capture a single screenshot buffer via the SDK.
 * Returns the decoded raw PNG buffer (not base64).
 */
async function captureBuffer(
  session: SessionState,
  timeoutMs: number
): Promise<Buffer> {
  const raw = await withRetry(
    () =>
      withTimeout(
        session.miniProgram!.screenshot({}),
        timeoutMs,
        'Screenshot capture'
      ),
    {
      maxRetries: 1,
      delayMs: 1000,
      shouldRetry: RetryPredicates.onConnectionError,
    }
  )

  // SDK returns base64 string when called without path
  if (typeof raw === 'string') {
    return Buffer.from(raw, 'base64')
  }
  if (raw instanceof Buffer) {
    return raw
  }
  return Buffer.from(raw as any)
}

/**
 * Stitch two images vertically using Jimp (transitive dependency of
 * miniprogram-automator).  No overlap handling — simple concatenation.
 */
async function stitchImages(topBuf: Buffer, bottomBuf: Buffer): Promise<Buffer> {
  const Jimp = (await import('jimp')).default
  const topImg = await Jimp.read(topBuf)
  const bottomImg = await Jimp.read(bottomBuf)

  const w = topImg.bitmap.width
  const totalH = topImg.bitmap.height + bottomImg.bitmap.height

  const result = new Jimp(w, totalH, 0xffffffff)
  result.blit(topImg, 0, 0)
  result.blit(bottomImg, 0, topImg.bitmap.height)

  return await result.getBufferAsync(Jimp.MIME_PNG)
}

async function screenshotImpl(
  session: SessionState,
  args: ScreenshotArgs = {}
): Promise<ScreenshotResult> {
  const { filename } = args
  const logger = session.logger
  const outputManager = session.outputManager
  const startTime = Date.now()

  try {
    if (!session.miniProgram) {
      throw new Error(
        'MiniProgram not connected. Call miniprogram_launch or miniprogram_connect first.'
      )
    }
    if (!outputManager) {
      throw new Error('OutputManager not available. Set outputDir in config.')
    }

    // Use the longer full-page timeout since stitching may take time
    const timeoutMs = getTimeout(
      session.config?.screenshotTimeout,
      DEFAULT_TIMEOUTS.screenshotFullPage
    )

    logger?.info('Taking screenshot', { filename, timeoutMs })

    // Resolve output filename
    const { validateFilename } = await import(
      '../../../runtime/validation/validation.js'
    )
    const resolvedFilename = filename
      ? (() => {
          validateFilename(filename, ['png', 'jpg', 'jpeg'])
          return filename
        })()
      : (() => {
          const generated = outputManager.generateFilename('screenshot', 'png')
          validateFilename(generated, ['png', 'jpg', 'jpeg'])
          return generated
        })()

    await outputManager.ensureOutputDir()

    // ── Detect scrollable content (scroll-view or page-level) ──────────
    const scrollInfo = await detectScrollableContent(session)

    if (scrollInfo) {
      logger?.info('Capturing full-page screenshot', {
        type: scrollInfo.type,
        scrollHeight: scrollInfo.scrollHeight,
        visibleHeight: scrollInfo.visibleHeight,
      })

      // 1. Scroll to top and capture
      await scrollInfo.scrollToTop()
      await sleep(400)
      const topBuffer = await captureBuffer(session, timeoutMs)

      // 2. Scroll to bottom and capture
      await scrollInfo.scrollToBottom()
      await sleep(400)
      const bottomBuffer = await captureBuffer(session, timeoutMs)

      // 3. Stitch vertically
      const stitchedBuffer = await stitchImages(topBuffer, bottomBuffer)

      // 4. Write final file
      await outputManager.writeFile(resolvedFilename, stitchedBuffer)

      const duration = Date.now() - startTime
      logger?.info('Full-page screenshot saved', {
        path: join(outputManager.getOutputDir(), resolvedFilename),
        duration,
      })

      return {
        success: true,
        message: 'Full-page screenshot captured successfully',
        path: join(outputManager.getOutputDir(), resolvedFilename),
      }
    }

    // ── Single viewport screenshot (no scrollable content) ──────────
    logger?.info('No scrollable content, taking single screenshot')

    const fullPath = join(outputManager.getOutputDir(), resolvedFilename)
    const screenshotBuffer = await withRetry(
      () =>
        withTimeout(
          session.miniProgram.screenshot({ path: fullPath }),
          timeoutMs,
          'Screenshot capture'
        ),
      {
        maxRetries: 2,
        delayMs: 1000,
        shouldRetry: RetryPredicates.onConnectionError,
        onRetry: (attempt, error) => {
          logger?.warn('Screenshot retry', { attempt, error: error.message })
        },
      }
    )

    // If SDK returned a buffer, write it ourselves
    let finalPath = fullPath
    if (screenshotBuffer) {
      const buf =
        screenshotBuffer instanceof Buffer
          ? screenshotBuffer
          : Buffer.from(screenshotBuffer as any)
      finalPath = await outputManager.writeFile(resolvedFilename, buf)
    }

    const duration = Date.now() - startTime
    logger?.info('Screenshot saved', { path: finalPath, duration })

    return {
      success: true,
      message: 'Screenshot captured successfully',
      path: finalPath,
    }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger?.error('Screenshot failed', {
      error: errorMessage,
      filename,
      duration,
    })

    throw new Error(`Screenshot failed: ${errorMessage}`)
  }
}
