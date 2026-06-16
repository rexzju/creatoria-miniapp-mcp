/**
 * getLogs handler — Read Mini Program runtime logs from DevTools simulator disk files
 *
 * The WeChat DevTools simulator automatically persists console/API output.
 * This handler discovers and reads those files — no SDK streaming needed.
 *
 * Log format: YYYY-M-D HH:mm:ss [level] message
 * File path:  ~/Library/.../WeappSimulator/WeappFileSystem/<openid>/<appid>/usr/miniprogramLog/log*
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { homedir, platform } from 'os'
import type { SessionState } from '../../../types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetLogsArgs {
  level?: string | string[]
  keyword?: string
  since?: string
  until?: string
  limit?: number
  file?: 'auto' | 'log1' | 'log2'
}

export interface LogEntry {
  timestamp: string
  level: string
  message: string
}

export interface GetLogsResult {
  success: boolean
  logs: LogEntry[]
  total: number
  file: string
  fileSize: number
  appid: string
}

// ---------------------------------------------------------------------------
// Log line parser
// ---------------------------------------------------------------------------

/**
 * Regex for parsing Mini Program log lines.
 *
 * Format: YYYY-M-D HH:mm:ss [LEVEL] message
 *
 * Examples:
 *   2026-6-16 11:56:6 [log] wx.getStorageSync api invoke
 *   2026-6-11 15:8:15 [warn] something happened
 *   2026-6-13 20:14:22 [ERROR] an error occurred
 *
 * Timestamp: month/day/hour/minute/second may or may not have leading zeros.
 * Level: case-insensitive, wrapped in brackets.
 */
const LOG_LINE_RE = /^(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})\s+\[(\w+)\]\s+(.*)$/

function parseLogLine(line: string): LogEntry | null {
  const match = line.match(LOG_LINE_RE)
  if (!match) return null
  return {
    timestamp: match[1],
    level: match[2].toLowerCase(),
    message: match[3],
  }
}

// ---------------------------------------------------------------------------
// Timestamp parsing (for since/until)
// ---------------------------------------------------------------------------

/**
 * Parse a time specification string into a Date.
 *
 * Supported formats:
 *   - Relative: "5m" (minutes), "30s" (seconds), "2h" (hours), "1d" (days)
 *   - ISO 8601:  "2026-06-16T10:30:00.000Z"
 *   - Epoch ms:  "1749976200000"
 *
 * Returns undefined for unparseable input.
 */
function parseTimestamp(input: string): Date | undefined {
  // Relative time: /^(\d+)(s|m|h|d)$/
  const rel = input.match(/^(\d+)(s|m|h|d)$/)
  if (rel) {
    const value = parseInt(rel[1], 10)
    const ms = (
      { s: value * 1000, m: value * 60 * 1000, h: value * 60 * 60 * 1000, d: value * 24 * 60 * 60 * 1000 } as Record<string, number>
    )[rel[2]]
    return new Date(Date.now() - ms)
  }

  // ISO 8601
  const iso = new Date(input)
  if (!isNaN(iso.getTime())) return iso

  // Unix epoch ms (numeric string)
  const num = Number(input)
  if (!isNaN(num) && num > 0 && input === String(num)) return new Date(num)

  return undefined
}

/**
 * Parse a log line timestamp string into a Date for comparison.
 *
 * The log format is "YYYY-M-D HH:mm:ss" (no leading zeros, no T, no Z).
 * E.g. "2026-6-16 11:56:6" = June 16 2026, 11:56:06.
 *
 * We parse manually because `new Date()` does not reliably handle
 * non-ISO timestamps without zero-padded fields.
 */
function parseLogTimestamp(ts: string): Date {
  const match = ts.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/
  )
  if (!match) return new Date(0)
  const [, year, month, day, hour, min, sec] = match
  return new Date(+year, +month - 1, +day, +hour, +min, +sec)
}

// ---------------------------------------------------------------------------
// AppID resolution
// ---------------------------------------------------------------------------

function resolveAppId(projectPath: string): string {
  const configPath = join(projectPath, 'project.config.json')
  if (!existsSync(configPath)) {
    throw new Error(
      `project.config.json not found at ${configPath}. Cannot determine appid.`
    )
  }

  let config: Record<string, unknown>
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    throw new Error(`Failed to parse project.config.json at ${configPath}`)
  }

  const appid = config.appid
  if (!appid || typeof appid !== 'string') {
    throw new Error(
      `appid field not found in project.config.json at ${configPath}`
    )
  }

  return appid
}

// ---------------------------------------------------------------------------
// DevTools data directory discovery
// ---------------------------------------------------------------------------

/**
 * Get the base directory for WeChat DevTools user data on the current platform.
 */
function getDevToolsBaseDir(): string {
  const home = homedir()
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', '微信开发者工具')
    case 'win32':
      // %APPDATA% is typically used, but the actual path could also be in LocalAppData
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), '微信开发者工具')
    case 'linux':
      return join(home, '.config', '微信开发者工具')
    default:
      // Fallback: try macOS path
      return join(home, 'Library', 'Application Support', '微信开发者工具')
  }
}

/**
 * Find Mini Program log files for a given appid.
 *
 * Scans: <baseDir>/* /WeappSimulator/WeappFileSystem/* /<appid>/usr/miniprogramLog/log*
 *
 * Returns file paths sorted by modification time (most recent first).
 * Falls back to touristappid if no match found.
 */
function findLogFiles(appid: string): string[] {
  const baseDir = getDevToolsBaseDir()

  if (!existsSync(baseDir)) {
    throw new Error(
      `WeChat DevTools data directory not found: ${baseDir}. ` +
        'Make sure WeChat DevTools is installed and has been launched at least once.'
    )
  }

  const results: string[] = []

  // Scan all hash directories under the base dir
  const hashDirs = readdirSync(baseDir)
  for (const hashDir of hashDirs) {
    const weappFsDir = join(baseDir, hashDir, 'WeappSimulator', 'WeappFileSystem')
    if (!existsSync(weappFsDir)) continue

    // Scan all openid directories
    let openidDirs: string[]
    try {
      openidDirs = readdirSync(weappFsDir)
    } catch {
      continue
    }

    for (const openidDir of openidDirs) {
      // Try the specific appid first
      const logDir = join(weappFsDir, openidDir, appid, 'usr', 'miniprogramLog')
      if (existsSync(logDir)) {
        collectLogFiles(logDir, results)
      }
    }
  }

  // Fallback: try touristappid
  if (results.length === 0) {
    for (const hashDir of hashDirs) {
      const weappFsDir = join(baseDir, hashDir, 'WeappSimulator', 'WeappFileSystem')
      if (!existsSync(weappFsDir)) continue

      let openidDirs: string[]
      try {
        openidDirs = readdirSync(weappFsDir)
      } catch {
        continue
      }

      for (const openidDir of openidDirs) {
        const logDir = join(weappFsDir, openidDir, 'touristappid', 'usr', 'miniprogramLog')
        if (existsSync(logDir)) {
          collectLogFiles(logDir, results)
        }
      }
    }
  }

  if (results.length === 0) {
    throw new Error(
      `No log files found for appid "${appid}" (or touristappid). ` +
        'Make sure the Mini Program has been launched in the DevTools simulator at least once.'
    )
  }

  // Sort by modification time, most recent first
  results.sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs
    } catch {
      return 0
    }
  })

  return results
}

function collectLogFiles(logDir: string, results: string[]): void {
  let files: string[]
  try {
    files = readdirSync(logDir)
  } catch {
    return
  }
  for (const file of files) {
    if (file.startsWith('log')) {
      results.push(join(logDir, file))
    }
  }
}

// ---------------------------------------------------------------------------
// Log reading and filtering
// ---------------------------------------------------------------------------

interface FilterOpts {
  level?: string | string[]
  keyword?: string
  since?: string
  until?: string
  limit: number
}

function readAndFilter(filePath: string, opts: FilterOpts): LogEntry[] {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  // Parse since/until boundaries once
  const sinceDate = opts.since ? parseTimestamp(opts.since) : undefined
  const untilDate = opts.until ? parseTimestamp(opts.until) : undefined

  // Normalize level filter
  const levelFilter: Set<string> | null = opts.level
    ? new Set(
        (Array.isArray(opts.level) ? opts.level : [opts.level]).map((l) =>
          l.toLowerCase()
        )
      )
    : null

  const keywordLower = opts.keyword?.toLowerCase()

  // Process lines in reverse (most recent first) for efficient tail+limit
  const matched: LogEntry[] = []

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.trim()) continue

    const entry = parseLogLine(line)
    if (!entry) continue

    // Filter by level
    if (levelFilter && !levelFilter.has(entry.level)) continue

    // Filter by keyword (case-insensitive)
    if (keywordLower && !entry.message.toLowerCase().includes(keywordLower)) continue

    // Filter by since
    if (sinceDate) {
      const entryDate = parseLogTimestamp(entry.timestamp)
      if (entryDate < sinceDate) continue
    }

    // Filter by until
    if (untilDate) {
      const entryDate = parseLogTimestamp(entry.timestamp)
      if (entryDate > untilDate) continue
    }

    matched.push(entry)

    // Stop early once we have enough results
    if (matched.length >= opts.limit) break
  }

  return matched
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function getLogs(
  session: SessionState,
  args: GetLogsArgs
): Promise<GetLogsResult> {
  // 1. Resolve project path and appid
  const projectPath = session.config?.projectPath
  if (!projectPath) {
    throw new Error(
      'Project path not configured. Set projectPath in MCP server config.'
    )
  }

  const appid = resolveAppId(projectPath)
  const logger = session.logger

  // 2. Find log files
  logger?.info('Reading Mini Program logs', { appid })
  const logFiles = findLogFiles(appid)

  // 3. Select the right file
  let filePath: string
  if (args.file && args.file !== 'auto') {
    // Find the specific named file
    const match = logFiles.find((f) => basename(f) === args.file)
    if (!match) {
      throw new Error(
        `Log file "${args.file}" not found for appid "${appid}". ` +
          `Available files: ${logFiles.map((f) => basename(f)).join(', ') || 'none'}`
      )
    }
    filePath = match
  } else {
    // Auto: pick the most recently modified file
    filePath = logFiles[0]
  }

  // 4. Get file size
  let fileSize = 0
  try {
    fileSize = statSync(filePath).size
  } catch {
    // Non-fatal
  }

  // 5. Read and filter (apply defaults matching the Zod schema)
  const limit = args.limit ?? 200
  const logs = readAndFilter(filePath, {
    level: args.level ?? 'error',
    keyword: args.keyword,
    since: args.since ?? '5m',
    until: args.until,
    limit,
  })

  logger?.info('Mini Program logs read', {
    appid,
    total: logs.length,
    file: basename(filePath),
    fileSize,
  })

  return {
    success: true,
    logs,
    total: logs.length,
    file: filePath,
    fileSize,
    appid,
  }
}
