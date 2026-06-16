/**
 * Unit tests for native-modal schemas and handlers
 */

import { confirmModalSchema, cancelModalSchema } from '../../src/capabilities/miniprogram/schemas/native-modal'
import { confirmModal, cancelModal } from '../../src/capabilities/miniprogram/handlers/native-modal'
import type { SessionState } from '../../src/types'

describe('Native Modal Schemas', () => {
  describe('confirmModalSchema', () => {
    it('should accept empty object', () => {
      const result = confirmModalSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('should accept extra properties (strip by default)', () => {
      const result = confirmModalSchema.safeParse({ extra: true })
      // Zod object().passthrough() by default — extra keys pass through
      expect(result.success).toBe(true)
    })
  })

  describe('cancelModalSchema', () => {
    it('should accept empty object', () => {
      const result = cancelModalSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('should accept extra properties', () => {
      const result = cancelModalSchema.safeParse({ extra: true })
      expect(result.success).toBe(true)
    })
  })
})

describe('Native Modal Handlers', () => {
  let mockSession: SessionState
  let mockNative: { confirmModal: jest.Mock; cancelModal: jest.Mock }
  let mockMiniProgram: { native: jest.Mock }

  beforeEach(() => {
    mockNative = {
      confirmModal: jest.fn().mockResolvedValue(undefined),
      cancelModal: jest.fn().mockResolvedValue(undefined),
    }

    mockMiniProgram = {
      native: jest.fn().mockReturnValue(mockNative),
    }

    mockSession = {
      sessionId: 'test-session',
      miniProgram: mockMiniProgram,
      pages: [],
      elements: new Map(),
      outputDir: '/tmp/test-output',
      createdAt: new Date(),
      lastActivity: new Date(),
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnThis(),
      },
    }

    jest.clearAllMocks()
  })

  // ── Success cases ──────────────────────────────────────────

  describe('confirmModal', () => {
    it('should click the confirm button and return success', async () => {
      const result = await confirmModal(mockSession)

      expect(result.success).toBe(true)
      expect(result.message).toBe('Native modal "OK" button clicked successfully.')
      expect(mockMiniProgram.native).toHaveBeenCalled()
      expect(mockNative.confirmModal).toHaveBeenCalled()
      expect(mockSession.logger?.info).toHaveBeenCalledWith(
        'Clicking native modal confirm button'
      )
    })

    it('should surface errors from DevTools rejection', async () => {
      mockNative.confirmModal.mockRejectedValue(new Error('No modal found'))

      await expect(confirmModal(mockSession)).rejects.toThrow(
        'confirmModal failed: No modal found'
      )
      expect(mockSession.logger?.error).toHaveBeenCalled()
    })
  })

  describe('cancelModal', () => {
    it('should click the cancel button and return success', async () => {
      const result = await cancelModal(mockSession)

      expect(result.success).toBe(true)
      expect(result.message).toBe('Native modal "Cancel" button clicked successfully.')
      expect(mockMiniProgram.native).toHaveBeenCalled()
      expect(mockNative.cancelModal).toHaveBeenCalled()
    })

    it('should surface errors from DevTools rejection', async () => {
      mockNative.cancelModal.mockRejectedValue(new Error('No modal found'))

      await expect(cancelModal(mockSession)).rejects.toThrow(
        'cancelModal failed: No modal found'
      )
    })
  })

  // ── Error / edge cases ─────────────────────────────────────

  describe('missing miniProgram', () => {
    it('confirmModal should throw with a clear message', async () => {
      mockSession.miniProgram = null

      await expect(confirmModal(mockSession)).rejects.toThrow(
        'MiniProgram not connected. Call miniprogram_launch or miniprogram_connect first.'
      )
    })

    it('cancelModal should throw with a clear message', async () => {
      mockSession.miniProgram = null

      await expect(cancelModal(mockSession)).rejects.toThrow(
        'MiniProgram not connected. Call miniprogram_launch or miniprogram_connect first.'
      )
    })
  })

  describe('missing native() API (old SDK)', () => {
    it('confirmModal should throw when native is not a function', async () => {
      mockSession.miniProgram = { native: null } as any

      await expect(confirmModal(mockSession)).rejects.toThrow(
        'Native API not available — miniprogram-automator SDK may be too old.'
      )
    })

    it('cancelModal should throw when native is not a function', async () => {
      mockSession.miniProgram = { native: 42 } as any // not a function

      await expect(cancelModal(mockSession)).rejects.toThrow(
        'Native API not available — miniprogram-automator SDK may be too old.'
      )
    })
  })

  describe('non-Error rejection', () => {
    it('should stringify non-Error rejection values', async () => {
      mockNative.confirmModal.mockRejectedValue('connection closed')

      await expect(confirmModal(mockSession)).rejects.toThrow(
        'confirmModal failed: connection closed'
      )
    })
  })
})
