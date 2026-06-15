/**
 * MCP Server implementation for WeChat Mini Program automation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createServer, IncomingMessage } from 'http'
import type { ServerConfig } from './types.js'
import { SessionStore } from './runtime/session/index.js'
import { setupCapabilities } from './capabilities/loader.js'
import { mergeServerConfig } from './config/defaults.js'
import { getConnectionManager, resetConnectionManager } from './runtime/connection/index.js'

/**
 * CompositeTransport 将多个 Transport 整合为一个，使 Server 可同时监听
 * stdio 和 HTTP 两种传输通道。消息分发至所有底层 transport。
 */
class CompositeTransport implements Transport {
  private transports: Transport[]

  constructor(transports: Transport[]) {
    this.transports = transports
  }

  get sessionId(): string | undefined {
    return this.transports[0]?.sessionId
  }

  set sessionId(id: string | undefined) {
    for (const t of this.transports) {
      t.sessionId = id
    }
  }

  set onmessage(handler: ((message: any, extra?: any) => void) | undefined) {
    for (const t of this.transports) {
      t.onmessage = handler
    }
  }
  get onmessage() {
    return this.transports[0]?.onmessage
  }

  set onclose(handler: (() => void) | undefined) {
    for (const t of this.transports) {
      t.onclose = handler
    }
  }
  get onclose() {
    return this.transports[0]?.onclose
  }

  set onerror(handler: ((error: Error) => void) | undefined) {
    for (const t of this.transports) {
      t.onerror = handler
    }
  }
  get onerror() {
    return this.transports[0]?.onerror
  }

  async start(): Promise<void> {
    await Promise.all(this.transports.map(t => t.start()))
  }

  async send(message: any, options?: any): Promise<void> {
    await Promise.all(this.transports.map(t => t.send(message, options)))
  }

  async close(): Promise<void> {
    await Promise.all(this.transports.map(t => t.close()))
  }
}

function bufferBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: string) => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/**
 * 轻量 health 检查 — 不依赖 pageStack，用 connectionManager.ping() 探活。
 * 仅在 WS 存活时才做全链路检查，避免半连接挂死。
 */
async function lightweightHealth(
  session: any,
  connectionManager: ReturnType<typeof getConnectionManager>
): Promise<Record<string, any>> {
  const config = session.config || {}
  const result: Record<string, any> = {
    ws_ok: false,
    logged_in: false,
    current_page: '',
    fullchain_ok: false,
    fullchain_error: null,
    gpu_status: 'n/a',
    devtools_port: config.port || 9420,
    http_port: 0,
  }

  const mp = connectionManager.miniProgram
  if (!mp) {
    result.fullchain_error = 'MiniProgram not connected (no active WS)'
    return result
  }

  // WS 探活：用 ping（3s 超时 evaluate(()=>true)）
  try {
    const alive = await connectionManager.ping()
    if (!alive) {
      result.fullchain_error = 'WS ping failed — connection dead'
      return result
    }
    result.ws_ok = true
  } catch (e: any) {
    result.fullchain_error = `WS ping error: ${e.message}`
    return result
  }

  // WS 正常 → 快速获取当前页面（3s 超时）
  try {
    const pageStack = await Promise.race([
      mp.pageStack(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('pageStack timeout after 3s')), 3000)
      ),
    ]) as any[]
    if (pageStack && pageStack.length > 0) {
      const current = pageStack[pageStack.length - 1]
      result.current_page = current?.path || ''
    }
  } catch {
    // pageStack 失败不阻断，ws_ok 仍为 true
    result.current_page = '(pageStack timeout)'
  }

  // 登录检查
  const LOGIN_PATTERNS = ['login', 'auth', 'phone', 'wechat']
  result.logged_in = !LOGIN_PATTERNS.some(
    (p: string) => (result.current_page || '').toLowerCase().includes(p)
  )

  // GPU 状态
  result.gpu_status = 'ok'

  // 全链路（仅在 WS 正常时执行）
  try {
    const fc: any = await Promise.race([
      mp.evaluate(() => {
        return new Promise((resolve) => {
          (globalThis as any).wx?.request?.({
            url: 'http://localhost:3001/health/fullchain',
            method: 'GET',
            success: (res: any) => {
              resolve({ ok: true, backend_ok: res.data?.backend_ok === true })
            },
            fail: (err: any) => {
              resolve({ ok: false, error: err.errMsg || 'fail' })
            },
          }) ?? resolve({ ok: false, error: 'wx not available' })
        })
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('fullchain timeout after 8s')), 8000)
      ),
    ])
    result.fullchain_ok = fc?.ok && fc?.backend_ok === true
    if (!result.fullchain_ok) {
      result.fullchain_error = fc?.error || '后端不可达'
    }
  } catch (e: any) {
    result.fullchain_error = `fullchain check failed: ${e.message}`
  }

  return result
}

export async function startServer(config: Partial<ServerConfig> = {}): Promise<Server> {
  const fullConfig = mergeServerConfig(config)
  const {
    capabilities,
    outputDir,
    sessionTimeout,
    logLevel,
    enableFileLog,
    logBufferSize,
    logFlushInterval,
    enableSessionReport,
    projectPath,
    cliPath,
    port,
    timeout,
    launchTimeout,
    connectTimeout,
    screenshotTimeout,
    server: serverMode,
    httpPort,
    disableGpu,
  } = fullConfig

  const sessionId = `session-${process.pid}-${Date.now()}`

  const sessionStore = new SessionStore({
    outputDir,
    sessionTimeout,
    enableSessionReport,
    loggerConfig: {
      level: logLevel,
      enableFileLog,
      outputDir,
      bufferSize: logBufferSize,
      flushInterval: logFlushInterval,
    },
  })

  // ── ConnectionManager 单例 ────────────────────────────
  const connectionManager = getConnectionManager()

  // 重连回调：更新 session 的 miniProgram
  connectionManager.onReconnect((mp: any) => {
    const session = sessionStore.get(sessionId)
    if (session) {
      session.miniProgram = mp
      console.error('ConnectionManager: session.miniProgram updated after reconnect')
    }
  })

  const server = new Server(
    {
      name: 'creatoria-miniapp-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  const { tools } = await setupCapabilities(server, {
    capabilities,
    sessionId,
    getSession: (sid) => {
      const sessionConfig = { projectPath, cliPath, port, timeout, launchTimeout, connectTimeout, screenshotTimeout, httpPort, disableGpu }
      const session = sessionStore.getOrCreate(sid, sessionConfig)
      sessionStore.updateActivity(sid)
      return session
    },
    deleteSession: (sid) => sessionStore.delete(sid),
  })

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools }
  })

  // ── 清理 ──────────────────────────────────────────────
  const cleanup = async () => {
    console.error('\nShutting down MCP server...')
    try {
      await connectionManager.dispose()
      await sessionStore.dispose()
      console.error('Cleanup completed')
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
    resetConnectionManager()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  const transports: Transport[] = serverMode
    ? []
    : [new StdioServerTransport()]

  let httpServer: ReturnType<typeof createServer> | undefined
  let httpTransport: StreamableHTTPServerTransport | undefined

  if (httpPort && httpPort > 0) {
    httpTransport = new StreamableHTTPServerTransport({
      // 无状态模式: sessionIdGenerator=undefined
      // 1. 任何客户端随时可 initialize, 互不冲突
      // 2. 调用 tools/call 不需要 Mcp-Session-Id 头
      // 3. 多开发者/多 Claude Code 会话可同时连接
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    httpServer = createServer(async (req, res) => {
      if (req.url === '/health') {
        const health: any = {
          pid: process.pid,
          httpPort,
          devtoolsPort: port || 9420,
          uptime_ms: Math.floor(process.uptime() * 1000),
        }
        // ── 重连状态（始终包含，即使 WS 正常）──
        health.reconnect = connectionManager.getReconnectHealth()
        try {
          const session = sessionStore.getOrCreate(sessionId, {
            projectPath, cliPath, port, timeout, launchTimeout, connectTimeout, screenshotTimeout, httpPort, disableGpu,
          })
          // 使用轻量 health 检查（ping + 条件式全链路）
          const healthResult = await Promise.race([
            lightweightHealth(session, connectionManager),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Health check timeout after 12s')), 12000)
            ),
          ])
          Object.assign(health, healthResult)
        } catch (e: any) {
          health.ws_ok = false
          health.logged_in = false
          health.fullchain_ok = false
          health.error = e?.message || 'Health probe failed'
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(health))
        return
      }

      if (req.url !== '/mcp') {
        res.writeHead(404)
        res.end()
        return
      }

      try {
        const body = await bufferBody(req)
        const parsedBody = body ? JSON.parse(body) : undefined
        await httpTransport!.handleRequest(
          req as IncomingMessage & { auth?: any },
          res,
          parsedBody
        )
      } catch (e: any) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: e.message }))
      }
    })

    httpServer.listen(httpPort, '127.0.0.1')
    console.error(`HTTP transport listening on http://127.0.0.1:${httpPort}/mcp`)
    transports.push(httpTransport)
  }

  const compositeTransport = new CompositeTransport(transports)
  await server.connect(compositeTransport)

  if (serverMode) {
    console.error('MCP Daemon running in HTTP-only server mode')
  } else {
    console.error('WeChat Mini Program MCP Server running on stdio')
  }
  console.error(`Capabilities: ${capabilities.join(', ')}`)
  console.error(`Tools registered: ${tools.length}`)

  // server 模式：通过 ConnectionManager 自动连接 DevTools
  if (serverMode && projectPath) {
    const sessionConfig = { projectPath, cliPath, port, timeout, launchTimeout, connectTimeout, screenshotTimeout, httpPort, disableGpu }
    try {
      const mp = await connectionManager.connect(sessionConfig)
      // 将 miniProgram 设置到 session
      const session = sessionStore.getOrCreate(sessionId, sessionConfig)
      session.miniProgram = mp
      console.error(`Auto-launched DevTools via ConnectionManager: port=${port || 9420}`)

      // 启动定时健康巡检（30s 间隔）
      connectionManager.startHealthCheck(30000)
    } catch (e: any) {
      console.error(`ConnectionManager: auto-launch failed: ${e.message}`)
      // 不阻塞启动 — 健康检查会检测到并尝试修复
      // 但仍启动定时巡检（重连循环内建）
      connectionManager.startHealthCheck(30000)
    }
  }

  return server
}
