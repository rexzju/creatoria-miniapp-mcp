/**
 * Unit tests for MiniProgram tools
 */

import * as miniprogramTools from '../../src/capabilities/miniprogram/handlers/index'
import type { SessionState } from '../../src/types'

// ---------------------------------------------------------------------------
// getLogs mocks — must be at top level (jest.mock is hoisted above imports).
// Use jest.fn() INSIDE the factory to avoid TDZ reference errors.
// ---------------------------------------------------------------------------
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  existsSync: jest.fn(),
}))

jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/Users/testuser'),
  platform: jest.fn().mockReturnValue('darwin'),
}))

// Get typed references to the mock functions via the mocked modules
import { readFileSync as _readFileSync, readdirSync as _readdirSync, statSync as _statSync, existsSync as _existsSync } from 'fs'
import { homedir as _homedir, platform as _platform } from 'os'

const mockReadFileSync = _readFileSync as jest.Mock
const mockReaddirSync = _readdirSync as jest.Mock
const mockStatSync = _statSync as jest.Mock
const mockExistsSync = _existsSync as jest.Mock
const mockHomedir = _homedir as jest.Mock
const mockPlatform = _platform as jest.Mock

// Lazy import after mocks are in place
let getLogs: typeof miniprogramTools.getLogs

const MOCK_APPID = 'wxbe47560d0d5ea84f'
const SAMPLE_LOG_CONTENT = [
  '2026-6-16 11:55:6 [log] wx.getStorageSync api invoke',
  '2026-6-16 11:55:6 [log] wx.request success callback with msg request:ok with seq 0',
  '2026-6-16 11:55:6 [warn] Some warning message',
  '2026-6-16 11:56:6 [error] TypeError: Cannot read property of undefined',
  '2026-6-16 11:56:6 [ERROR] Uncaught promise rejection',
].join('\n')

function setupDefaultMocks() {
  mockHomedir.mockReturnValue('/Users/testuser')
  mockPlatform.mockReturnValue('darwin')

  mockExistsSync.mockImplementation((p: string) => {
    // Default: everything exists
    return true
  })

  mockReadFileSync.mockImplementation((p: string) => {
    if (p.includes('project.config.json')) {
      return JSON.stringify({ appid: MOCK_APPID })
    }
    if (p.includes('miniprogramLog/log')) {
      return SAMPLE_LOG_CONTENT
    }
    return ''
  })

  mockReaddirSync.mockImplementation((p: string) => {
    // Order matters: most specific match first (miniprogramLog path also
    // contains WeappFileSystem as a parent-path substring)
    if (p.includes('miniprogramLog')) return ['log1', 'log2']
    if (p.includes('WeappFileSystem')) return ['openid123']
    if (p.endsWith('微信开发者工具')) return ['hash123']
    return []
  })

  mockStatSync.mockReturnValue({ mtimeMs: Date.now(), size: 1024 } as any)
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'test-session',
    pages: [],
    elements: new Map(),
    outputDir: '/tmp/test-output',
    createdAt: new Date(),
    lastActivity: new Date(),
    config: { projectPath: '/Users/testuser/projects/my-miniapp' },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    },
    outputManager: {
      getOutputDir: jest.fn().mockReturnValue('/tmp/test-output'),
      generateFilename: jest.fn().mockReturnValue('screenshot-1.png'),
      writeFile: jest.fn().mockResolvedValue('/tmp/test-output/screenshot-1.png'),
      ensureOutputDir: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

describe('MiniProgram Tools', () => {
  let mockSession: SessionState

  beforeEach(() => {
    mockSession = {
      sessionId: 'test-session',
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
      outputManager: {
        getOutputDir: jest.fn().mockReturnValue('/tmp/test-output'),
        generateFilename: jest.fn().mockReturnValue('screenshot-1.png'),
        writeFile: jest.fn().mockResolvedValue('/tmp/test-output/screenshot-1.png'),
        ensureOutputDir: jest.fn().mockResolvedValue(undefined),
      },
    }

    jest.clearAllMocks()
  })

  describe('navigate', () => {
    it('should navigate using navigateTo', async () => {
      const mockMiniProgram = {
        navigateTo: jest.fn().mockResolvedValue(undefined),
        currentPage: jest.fn().mockResolvedValue({ path: '/pages/target/index' }),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.navigate(mockSession, {
        method: 'navigateTo',
        url: '/pages/target/index',
      })

      expect(result.success).toBe(true)
      expect(result.currentPage).toBe('/pages/target/index')
      expect(mockMiniProgram.navigateTo).toHaveBeenCalledWith('/pages/target/index')
    })

    it('should navigate using redirectTo', async () => {
      const mockMiniProgram = {
        redirectTo: jest.fn().mockResolvedValue(undefined),
        currentPage: jest.fn().mockResolvedValue({ path: '/pages/new/index' }),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.navigate(mockSession, {
        method: 'redirectTo',
        url: '/pages/new/index',
      })

      expect(result.success).toBe(true)
      expect(mockMiniProgram.redirectTo).toHaveBeenCalledWith('/pages/new/index')
    })

    it('should navigate using reLaunch', async () => {
      const mockMiniProgram = {
        reLaunch: jest.fn().mockResolvedValue(undefined),
        currentPage: jest.fn().mockResolvedValue({ path: '/pages/home/index' }),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.navigate(mockSession, {
        method: 'reLaunch',
        url: '/pages/home/index',
      })

      expect(result.success).toBe(true)
      expect(mockMiniProgram.reLaunch).toHaveBeenCalledWith('/pages/home/index')
    })

    it('should navigate using switchTab', async () => {
      const mockMiniProgram = {
        switchTab: jest.fn().mockResolvedValue(undefined),
        currentPage: jest.fn().mockResolvedValue({ path: '/pages/tab/index' }),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.navigate(mockSession, {
        method: 'switchTab',
        url: '/pages/tab/index',
      })

      expect(result.success).toBe(true)
      expect(mockMiniProgram.switchTab).toHaveBeenCalledWith('/pages/tab/index')
    })

    it('should navigate using navigateBack', async () => {
      const mockMiniProgram = {
        navigateBack: jest.fn().mockResolvedValue(undefined),
        currentPage: jest.fn().mockResolvedValue({ path: '/pages/previous/index' }),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.navigate(mockSession, {
        method: 'navigateBack',
        delta: 2,
      })

      expect(result.success).toBe(true)
      expect(mockMiniProgram.navigateBack).toHaveBeenCalledWith(2)
    })

    it('should throw error if miniprogram not connected', async () => {
      mockSession.miniProgram = undefined

      await expect(
        miniprogramTools.navigate(mockSession, {
          method: 'navigateTo',
          url: '/pages/test',
        })
      ).rejects.toThrow('MiniProgram not connected')
    })

    it('should throw error if URL missing for navigateTo', async () => {
      mockSession.miniProgram = {
        navigateTo: jest.fn(),
        currentPage: jest.fn(),
      }

      await expect(
        miniprogramTools.navigate(mockSession, {
          method: 'navigateTo',
        } as any)
      ).rejects.toThrow('URL is required for navigateTo')
    })

    it('should log navigation attempts', async () => {
      const mockMiniProgram = {
        navigateTo: jest.fn().mockResolvedValue(undefined),
        currentPage: jest.fn().mockResolvedValue({ path: '/pages/test' }),
      }
      mockSession.miniProgram = mockMiniProgram

      await miniprogramTools.navigate(mockSession, {
        method: 'navigateTo',
        url: '/pages/test',
      })

      expect(mockSession.logger?.info).toHaveBeenCalledWith(
        'Navigating using navigateTo',
        expect.any(Object)
      )
    })
  })

  describe('callWx', () => {
    it('should call wx method successfully', async () => {
      const mockMiniProgram = {
        callWxMethod: jest.fn().mockResolvedValue({ success: true }),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.callWx(mockSession, {
        method: 'showToast',
        args: [{ title: 'Hello' }],
      })

      expect(result.success).toBe(true)
      expect(result.result).toEqual({ success: true })
      expect(mockMiniProgram.callWxMethod).toHaveBeenCalledWith('showToast', { title: 'Hello' })
    })

    it('should call wx method without arguments', async () => {
      const mockMiniProgram = {
        callWxMethod: jest.fn().mockResolvedValue({ data: 'test' }),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.callWx(mockSession, {
        method: 'getStorageInfo',
      })

      expect(result.success).toBe(true)
      expect(mockMiniProgram.callWxMethod).toHaveBeenCalledWith('getStorageInfo')
    })

    it('should throw error if miniprogram not connected', async () => {
      mockSession.miniProgram = undefined

      await expect(
        miniprogramTools.callWx(mockSession, {
          method: 'showToast',
        })
      ).rejects.toThrow('MiniProgram not connected')
    })

    it('should log wx method calls', async () => {
      const mockMiniProgram = {
        callWxMethod: jest.fn().mockResolvedValue({ success: true }),
      }
      mockSession.miniProgram = mockMiniProgram

      await miniprogramTools.callWx(mockSession, {
        method: 'request',
        args: [{ url: 'https://api.example.com' }],
      })

      expect(mockSession.logger?.info).toHaveBeenCalledWith(
        'Calling wx.request',
        expect.any(Object)
      )
    })
  })

  describe('evaluate', () => {
    it('should evaluate expression successfully', async () => {
      const mockMiniProgram = {
        evaluate: jest.fn().mockResolvedValue(42),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.evaluate(mockSession, {
        expression: '1 + 1',
      })

      expect(result.success).toBe(true)
      expect(result.result).toBe(42)
      expect(mockMiniProgram.evaluate).toHaveBeenCalledWith('1 + 1')
    })

    it('should evaluate with arguments', async () => {
      const mockMiniProgram = {
        evaluate: jest.fn().mockResolvedValue('Hello World'),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.evaluate(mockSession, {
        expression: '(a, b) => a + b',
        args: ['Hello', ' World'],
      })

      expect(result.success).toBe(true)
      expect(mockMiniProgram.evaluate).toHaveBeenCalledWith('(a, b) => a + b', 'Hello', ' World')
    })

    it('should throw error if miniprogram not connected', async () => {
      mockSession.miniProgram = undefined

      await expect(
        miniprogramTools.evaluate(mockSession, {
          expression: '1 + 1',
        })
      ).rejects.toThrow('MiniProgram not connected')
    })

    it('should log evaluation attempts', async () => {
      const mockMiniProgram = {
        evaluate: jest.fn().mockResolvedValue(100),
      }
      mockSession.miniProgram = mockMiniProgram

      await miniprogramTools.evaluate(mockSession, {
        expression: '() => 100',
      })

      expect(mockSession.logger?.info).toHaveBeenCalledWith(
        '[SECURITY] Evaluating expression',
        expect.any(Object)
      )
    })
  })

  describe('screenshot', () => {
    it('should take screenshot successfully', async () => {
      const mockMiniProgram = {
        screenshot: jest.fn().mockResolvedValue(Buffer.from('image')),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.screenshot(mockSession, {
        filename: 'test.png',
      })

      expect(result.success).toBe(true)
      expect(result.path).toBe('/tmp/test-output/screenshot-1.png')
      expect(mockSession.outputManager?.ensureOutputDir).toHaveBeenCalled()
    })

    it('should take fullPage screenshot', async () => {
      const mockMiniProgram = {
        screenshot: jest.fn().mockResolvedValue(Buffer.from('image')),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.screenshot(mockSession, {
        fullPage: true,
      } as any)

      expect(result.success).toBe(true)
      expect(mockMiniProgram.screenshot).toHaveBeenCalledWith({
        path: expect.any(String),
        fullPage: true,
      })
    })

    it('should auto-generate filename if not provided', async () => {
      const mockMiniProgram = {
        screenshot: jest.fn().mockResolvedValue(Buffer.from('image')),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.screenshot(mockSession)

      expect(result.success).toBe(true)
      expect(mockSession.outputManager?.generateFilename).toHaveBeenCalledWith('screenshot', 'png')
    })

    it('should throw error if miniprogram not connected', async () => {
      mockSession.miniProgram = undefined

      await expect(miniprogramTools.screenshot(mockSession)).rejects.toThrow(
        'MiniProgram not connected'
      )
    })

    it('should throw error if outputManager not available', async () => {
      mockSession.miniProgram = { screenshot: jest.fn() }
      mockSession.outputManager = undefined

      await expect(miniprogramTools.screenshot(mockSession)).rejects.toThrow(
        'OutputManager not available'
      )
    })
  })

  describe('getPageStack', () => {
    it('should get page stack successfully', async () => {
      const mockPageStack = [
        { path: '/pages/index/index', query: {} },
        { path: '/pages/detail/detail', query: { id: '123' } },
      ]
      const mockMiniProgram = {
        pageStack: jest.fn().mockResolvedValue(mockPageStack),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.getPageStack(mockSession)

      expect(result.success).toBe(true)
      expect(result.pages).toHaveLength(2)
      expect(result.pages[0].path).toBe('/pages/index/index')
      expect(result.pages[1].query).toEqual({ id: '123' })
      expect(mockSession.pages).toEqual(mockPageStack)
    })

    it('should throw error if miniprogram not connected', async () => {
      mockSession.miniProgram = undefined

      await expect(miniprogramTools.getPageStack(mockSession)).rejects.toThrow(
        'MiniProgram not connected'
      )
    })
  })

  describe('getSystemInfo', () => {
    it('should get system info successfully', async () => {
      const mockSystemInfo = {
        platform: 'devtools',
        system: 'macOS',
        version: '1.0.0',
      }
      const mockMiniProgram = {
        systemInfo: jest.fn().mockResolvedValue(mockSystemInfo),
      }
      mockSession.miniProgram = mockMiniProgram

      const result = await miniprogramTools.getSystemInfo(mockSession)

      expect(result.success).toBe(true)
      expect(result.systemInfo).toEqual(mockSystemInfo)
    })

    it('should throw error if miniprogram not connected', async () => {
      mockSession.miniProgram = undefined

      await expect(miniprogramTools.getSystemInfo(mockSession)).rejects.toThrow(
        'MiniProgram not connected'
      )
    })
  })

  describe('concurrency serialization (session lock)', () => {
    it('serializes concurrent screenshots so the SDK is never called in parallel', async () => {
      let inFlight = 0
      let maxInFlight = 0
      const sdkScreenshot = jest.fn().mockImplementation(async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 10))
        inFlight--
        return Buffer.from('img')
      })
      mockSession.miniProgram = { screenshot: sdkScreenshot }

      // Fire 8 screenshots concurrently
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          miniprogramTools.screenshot(mockSession, { returnBase64: true } as any)
        )
      )

      expect(results.every((r) => r.success)).toBe(true)
      expect(sdkScreenshot).toHaveBeenCalledTimes(8)
      // The key assertion: never more than one SDK call running at the same time.
      expect(maxInFlight).toBe(1)
    })

    it('serializes screenshot against other SDK operations on the same session', async () => {
      const order: string[] = []
      let inFlight = 0
      let maxInFlight = 0
      const track = (label: string, ms: number) =>
        jest.fn().mockImplementation(async () => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          order.push(`start:${label}`)
          await new Promise((r) => setTimeout(r, ms))
          order.push(`end:${label}`)
          inFlight--
          return label === 'eval' ? 'evaluated' : Buffer.from('img')
        })

      mockSession.miniProgram = {
        screenshot: track('shot', 15),
        evaluate: track('eval', 5),
      }

      await Promise.all([
        miniprogramTools.screenshot(mockSession, { returnBase64: true } as any),
        miniprogramTools.evaluate(mockSession, { expression: '1+1' }),
      ])

      // screenshot and evaluate must not overlap on the shared WebSocket
      expect(maxInFlight).toBe(1)
    })
  })

  describe('getLogs', () => {
    beforeAll(async () => {
      // The getLogs handler must be imported AFTER jest.mock calls are set up
      const mod = await import('../../src/capabilities/miniprogram/handlers/logs.js')
      getLogs = mod.getLogs
    })

    beforeEach(() => {
      jest.clearAllMocks()
      setupDefaultMocks()
      // Pin Date.now() to match the sample log timestamps.
      // Log timestamps have NO timezone → parsed as LOCAL time by parseLogTimestamp.
      // The mocked value must also use LOCAL time so comparisons are consistent.
      jest.spyOn(Date, 'now').mockReturnValue(
        new Date('2026-06-16T11:57:00').getTime()
      )
    })

    it('should throw error if projectPath not configured', async () => {
      const session = makeSession({ config: undefined })

      await expect(getLogs(session, {})).rejects.toThrow(
        'Project path not configured'
      )
    })

    it('should throw error if project.config.json missing', async () => {
      const session = makeSession()
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('project.config.json')) return false
        return true
      })

      await expect(getLogs(session, {})).rejects.toThrow(
        'project.config.json not found'
      )
    })

    it('should throw error if appid not in project.config.json', async () => {
      const session = makeSession()
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('project.config.json')) return JSON.stringify({})
        return ''
      })

      await expect(getLogs(session, {})).rejects.toThrow(
        'appid field not found'
      )
    })

    it('should throw error if DevTools data dir not found', async () => {
      const session = makeSession()
      // Only project.config.json exists, but base dir doesn't
      mockExistsSync.mockImplementation((p: string) => {
        return p.endsWith('project.config.json')
      })

      await expect(getLogs(session, {})).rejects.toThrow(
        'WeChat DevTools data directory not found'
      )
    })

    it('should return logs with default filters (error, since=5m)', async () => {
      const session = makeSession()
      const result = await getLogs(session, {})

      expect(result.success).toBe(true)
      expect(result.appid).toBe(MOCK_APPID)
      // Both error-level lines (normalized to lowercase)
      expect(result.logs).toHaveLength(2)
      // Most recent first
      expect(result.logs[0].level).toBe('error')
      expect(result.logs[0].message).toBe('Uncaught promise rejection')
      expect(result.logs[1].level).toBe('error')
      expect(result.logs[1].message).toBe('TypeError: Cannot read property of undefined')
    })

    it('should filter by single level', async () => {
      const session = makeSession()
      const result = await getLogs(session, { level: 'warn', since: '1d' })

      expect(result.logs).toHaveLength(1)
      expect(result.logs[0].level).toBe('warn')
    })

    it('should filter by level array', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: ['warn', 'error'],
        since: '1d',
      })

      expect(result.logs).toHaveLength(3) // 1 warn + 2 error
    })

    it('should filter by keyword (case-insensitive)', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: undefined,
        since: '1d',
        keyword: 'TypeError',
      })

      expect(result.logs).toHaveLength(1)
      expect(result.logs[0].message).toContain('TypeError')
    })

    it('should filter by keyword case-insensitively', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: undefined,
        since: '1d',
        keyword: 'typeerror',
      })

      expect(result.logs).toHaveLength(1)
    })

    it('should filter by since with relative time (5m)', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: undefined,
        since: '5m',
      })

      // All sample lines should be within 5 minutes (they're dated "now")
      expect(result.logs.length).toBeGreaterThan(0)
    })

    it('should filter by since with ISO timestamp', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: undefined,
        since: '2026-06-16T11:56:00.000Z',
      })

      // Only entries at or after 11:56
      expect(result.logs.every((l) => l.timestamp >= '2026-6-16 11:56:')).toBe(true)
    })

    it('should filter by since with epoch ms', async () => {
      const session = makeSession()
      // Epoch for 2026-06-16T11:56:00 UTC
      const epoch = Date.UTC(2026, 5, 16, 11, 56, 0)
      const result = await getLogs(session, {
        level: undefined,
        since: String(epoch),
      })

      expect(result.logs.every((l) => l.timestamp >= '2026-6-16 11:56:')).toBe(true)
    })

    it('should filter by until', async () => {
      const session = makeSession()
      // Use epoch ms to avoid ISO parsing timezone ambiguity.
      // untilMs = local 2026-06-16 11:55:30 → entries at 11:56:06 excluded
      const untilMs = new Date(2026, 5, 16, 11, 55, 30).getTime()
      const result = await getLogs(session, {
        level: ['log', 'info', 'warn', 'error'],
        since: String(new Date(2026, 5, 15).getTime()), // epoch for yesterday 00:00
        until: String(untilMs),
      })

      // Entries before 11:55:30 = 3 log lines at 11:55:06
      expect(result.logs).toHaveLength(3)
      expect(result.logs.every((l) => l.timestamp.startsWith('2026-6-16 11:55:'))).toBe(true)
    })

    it('should respect limit parameter', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: undefined,
        since: '1d',
        limit: 2,
      })

      expect(result.logs).toHaveLength(2)
    })

    it('should default to limit 200', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: undefined,
        since: '1d',
      })

      expect(result.logs.length).toBeLessThanOrEqual(200)
    })

    it('should return most recent logs first', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: ['log', 'info', 'warn', 'error'],
        since: '1d',
      })

      expect(result.logs).toHaveLength(5)
      expect(result.logs[0].timestamp).toBe('2026-6-16 11:56:6')
    })

    it('should return file path and size', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: undefined,
        since: '1d',
      })

      expect(result.file).toContain('miniprogramLog/log1')
      expect(result.fileSize).toBe(1024)
    })

    it('should skip unparseable lines gracefully', async () => {
      const session = makeSession()
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('project.config.json')) {
          return JSON.stringify({ appid: MOCK_APPID })
        }
        if (p.includes('miniprogramLog/log')) {
          return [
            'This is not a log line',
            '',
            '2026-6-16 11:56:6 [info] valid line',
            'another garbage line',
          ].join('\n')
        }
        return ''
      })

      const result = await getLogs(session, {
        level: ['log', 'info', 'warn', 'error'],
        since: '1d',
      })

      expect(result.logs).toHaveLength(1)
      expect(result.logs[0].level).toBe('info')
      expect(result.logs[0].message).toBe('valid line')
    })

    it('should select specific log file', async () => {
      const session = makeSession()
      const result = await getLogs(session, {
        level: undefined,
        since: '1d',
        file: 'log2',
      })

      expect(result.file).toContain('log2')
    })

    it('should handle touristappid fallback', async () => {
      const session = makeSession()
      // Only touristappid directory exists, not mockAppid
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('project.config.json')) return true
        if (p.includes(MOCK_APPID)) return false
        if (p.includes('touristappid/usr/miniprogramLog')) return true
        if (p.includes('touristappid')) return true
        if (p.endsWith('微信开发者工具')) return true
        if (p.includes('WeappSimulator')) return true
        if (p.includes('WeappFileSystem')) return true
        if (p.includes('miniprogramLog')) return true
        return false
      })
      mockReaddirSync.mockImplementation((p: string) => {
        if (p.includes('miniprogramLog')) return ['log1']
        if (p.includes('WeappFileSystem')) return ['openid123']
        if (p.endsWith('微信开发者工具')) return ['hash123']
        return []
      })

      const result = await getLogs(session, {
        level: undefined,
        since: '1d',
      })

      expect(result.success).toBe(true)
    })

    it('should throw if specified log file not found', async () => {
      const session = makeSession()
      mockReaddirSync.mockImplementation((p: string) => {
        if (p.includes('miniprogramLog')) return ['log1'] // only log1, no log2
        if (p.includes('WeappFileSystem')) return ['openid123']
        if (p.endsWith('微信开发者工具')) return ['hash123']
        return []
      })

      await expect(
        getLogs(session, { level: undefined, since: '1d', file: 'log2' })
      ).rejects.toThrow('Log file "log2" not found')
    })
  })
})
