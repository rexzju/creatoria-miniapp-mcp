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

  process.on('SIGINT', async () => {
    console.error('\nShutting down MCP server...')
    try {
      await sessionStore.dispose()
      console.error('Cleanup completed')
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.error('\nShutting down MCP server...')
    try {
      await sessionStore.dispose()
      console.error('Cleanup completed')
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
    process.exit(0)
  })

  const transports: Transport[] = serverMode
    ? []
    : [new StdioServerTransport()]

  let httpServer: ReturnType<typeof createServer> | undefined
  let httpTransport: StreamableHTTPServerTransport | undefined

  if (httpPort && httpPort > 0) {
    httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () =>
        `http-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
        try {
          const session = sessionStore.getOrCreate(sessionId, {
            projectPath, cliPath, port, timeout, launchTimeout, connectTimeout, screenshotTimeout, httpPort, disableGpu,
          })
          const { getHealth } = await import(
            './capabilities/miniprogram/handlers/health.js'
          )
          // 加 5s 超时保护，防止 WS 半连接导致 health 端点永久挂起
          const healthResult = await Promise.race([
            getHealth(session),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Health check timeout after 5s')), 5000)
            ),
          ])
          Object.assign(health, healthResult)
        } catch (e: any) {
          health.ws_ok = false
          health.logged_in = false
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

  // server 模式：自动连接 DevTools
  if (serverMode && projectPath) {
    const session = sessionStore.getOrCreate(sessionId, {
      projectPath, cliPath, port, timeout, launchTimeout, connectTimeout, screenshotTimeout, httpPort, disableGpu,
    })
    try {
      const { launch } = await import('./capabilities/automator/handlers/launch.js')
      const result = await launch(session, { projectPath, cliPath, port, reuseExisting: true })
      console.error(`Auto-launched DevTools: ${JSON.stringify(result)}`)
    } catch (e: any) {
      console.error(`Auto-launch failed: ${e.message}`)
      // 不阻塞启动，setup_env 的 health check 会检测到并修复
    }
  }

  return server
}
