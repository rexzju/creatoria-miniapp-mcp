/**
 * ConnectionManager — 单例 WebSocket 连接管理器
 *
 * 职责：
 * 1. 持有唯一的 MiniProgram 实例（所有 MCP session 共享）
 * 2. WS 断开时自动重连（指数退避 1s→2s→4s→…→30s）
 * 3. 30s 定时健康巡检，发现断开立即重连
 * 4. 重连成功后通过回调通知外部更新 session
 * 5. 提供轻量 health check（不依赖 pageStack，用 evaluate 探活）
 */

import automator from 'miniprogram-automator'
import type { SessionConfig } from '../../types.js'
import { withTimeout, DEFAULT_TIMEOUTS } from '../timeout/timeout.js'
import { probePort } from '../network/probe-port.js'

const DEFAULT_PORT = 9420

/** 重连回调：外部（server.ts）注册，在重连成功后更新 session.miniProgram */
export type ReconnectCallback = (mp: any) => void

/** 重连状态 */
export type ReconnectStatus = 'ok' | 'degraded' | 'broken'

/** 重连健康摘要 */
export interface ReconnectHealth {
  state: ReconnectStatus
  consecutive_failures: number
  last_error: string | null
  failing_since_ms: number | null
  backoff_ms: number
}

const MAX_CONSECUTIVE_FAILURES = 5 // 连续失败阈值，超过即为 broken

export class ConnectionManager {
  private _mp: any = null
  private _config: SessionConfig | null = null
  private _reconnectPromise: Promise<any> | null = null
  private _backoffMs = 1000
  private _maxBackoff = 30000
  private _healthTimer: ReturnType<typeof setInterval> | null = null
  private _healthIntervalMs = 30000
  private _reconnectCallbacks: ReconnectCallback[] = []
  private _disposed = false
  private _pingLock = false // 防止健康检查与工具调用同时 ping
  // ── 失败追踪 ──
  private _consecutiveFailures = 0
  private _lastReconnectError: string | null = null
  private _failingSinceMs: number | null = null

  // ── 公开 API ──────────────────────────────────────────

  /** 当前 MiniProgram 实例（可能为 null） */
  get miniProgram(): any {
    return this._mp
  }

  /** 是否已连接（粗略判断，不做 WS 探活） */
  get isConnected(): boolean {
    return this._mp != null
  }

  /**
   * 重连健康摘要 — 供 /health 端点和 MCP 工具消费。
   *
   * state 含义：
   *   ok       — WS 正常或未曾重连
   *   degraded — 重连中，连续失败 < 阈值
   *   broken   — 连续失败 >= 5 次，需要人工介入
   */
  getReconnectHealth(): ReconnectHealth {
    if (this._consecutiveFailures === 0) {
      return {
        state: 'ok',
        consecutive_failures: 0,
        last_error: null,
        failing_since_ms: null,
        backoff_ms: this._backoffMs,
      }
    }
    if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      return {
        state: 'broken',
        consecutive_failures: this._consecutiveFailures,
        last_error: this._lastReconnectError,
        failing_since_ms: this._failingSinceMs ? Date.now() - this._failingSinceMs : null,
        backoff_ms: this._backoffMs,
      }
    }
    return {
      state: 'degraded',
      consecutive_failures: this._consecutiveFailures,
      last_error: this._lastReconnectError,
      failing_since_ms: this._failingSinceMs ? Date.now() - this._failingSinceMs : null,
      backoff_ms: this._backoffMs,
    }
  }

  /**
   * 连接 DevTools，优先复用已有连接（probePort → connect），
   * 端口不可达则 launch 新实例。
   */
  async connect(config: SessionConfig): Promise<any> {
    this._config = { ...config }
    this._disposed = false

    const port = config.port || DEFAULT_PORT
    const projectPath = config.projectPath || ''
    const cliPath = config.cliPath || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

    // 1) 尝试复用已有 DevTools
    const portAlive = await probePort(port, 1000)
    if (portAlive) {
      try {
        const connectTimeout = config.connectTimeout || DEFAULT_TIMEOUTS.connect
        this._mp = await withTimeout(
          automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` } as any),
          connectTimeout,
          'ConnectionManager: connect to existing DevTools'
        )
        console.error(`ConnectionManager: WS connected to existing DevTools (port ${port})`)
        this._backoffMs = 1000
        return this._mp
      } catch (e: any) {
        console.error(`ConnectionManager: fast-connect failed (${e.message}), falling through to launch`)
        this._mp = null
      }
    }

    // 2) launch 新实例
    const disableGpu = config.disableGpu !== false
    const launchArgs = disableGpu ? ['--disable-gpu'] : []
    const launchTimeout = config.launchTimeout || DEFAULT_TIMEOUTS.launch

    this._mp = await withTimeout(
      automator.launch({
        projectPath,
        cliPath,
        port,
        args: launchArgs,
        timeout: launchTimeout,
      }),
      launchTimeout,
      'ConnectionManager: launch DevTools'
    )
    console.error(`ConnectionManager: DevTools launched (port ${port})`)
    this._resetFailureTracking()
    return this._mp
  }

  /**
   * 轻量健康检查：通过 evaluate 发一个最小 JS 探测 WS 是否存活。
   * 返回 true 表示 WS 通路正常。
   */
  async ping(): Promise<boolean> {
    const mp = this._mp
    if (!mp) return false
    if (this._pingLock) return true // 正在 ping 中，保守返回 true

    this._pingLock = true
    try {
      await withTimeout(
        Promise.resolve(mp.evaluate(() => true)),
        3000,
        'ConnectionManager: ping'
      )
      this._resetFailureTracking() // ping 成功 = WS 正常
      return true
    } catch {
      console.error('ConnectionManager: ping failed, WS may be dead')
      this._mp = null // 标记为断开，等待重连
      return false
    } finally {
      this._pingLock = false
    }
  }

  /**
   * 主动重连：先尝试 connect（DevTools 还在），失败则 launch。
   * 多调用方并发时只执行一次实际重连。
   */
  async reconnect(): Promise<any> {
    if (this._disposed) throw new Error('ConnectionManager disposed')

    // 如果正在重连，等待已有的重连 Promise
    if (this._reconnectPromise) {
      console.error('ConnectionManager: waiting for ongoing reconnect...')
      return this._reconnectPromise
    }

    this._mp = null
    this._reconnectPromise = this._reconnectLoop()
    try {
      const mp = await this._reconnectPromise
      this._mp = mp
      // 通知所有回调
      for (const cb of this._reconnectCallbacks) {
        try { cb(mp) } catch {}
      }
      return mp
    } finally {
      this._reconnectPromise = null
    }
  }

  /** 注册重连成功回调 */
  onReconnect(cb: ReconnectCallback): void {
    this._reconnectCallbacks.push(cb)
  }

  /** 启动定时健康巡检 */
  startHealthCheck(intervalMs = 30000): void {
    if (this._healthTimer) return
    this._healthIntervalMs = intervalMs

    // 使用递归 setTimeout 而非 setInterval，避免健康检查堆积
    const schedule = () => {
      if (this._disposed) return
      this._healthTimer = setTimeout(async () => {
        if (this._disposed) return
        const alive = await this.ping()
        if (!alive) {
          console.error('ConnectionManager: health check FAILED — triggering reconnect')
          this.reconnect().catch((e) =>
            console.error(`ConnectionManager: reconnect from health-check failed: ${e.message}`)
          )
        }
        schedule()
      }, this._healthIntervalMs)
      if (this._healthTimer.unref) this._healthTimer.unref()
    }
    schedule()
    console.error(`ConnectionManager: health check started (interval=${intervalMs}ms)`)
  }

  /** 停止健康巡检并断开连接 */
  async dispose(): Promise<void> {
    this._disposed = true
    if (this._healthTimer) {
      clearTimeout(this._healthTimer)
      this._healthTimer = null
    }
    if (this._mp) {
      try {
        await Promise.race([
          this._mp.disconnect(),
          new Promise((r) => setTimeout(r, 2000)),
        ])
      } catch {}
      this._mp = null
    }
    this._reconnectCallbacks = []
    console.error('ConnectionManager: disposed')
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 指数退避重连循环 */
  private async _reconnectLoop(): Promise<any> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this._disposed) throw new Error('ConnectionManager disposed during reconnect')

      try {
        // 先尝试断开旧连接（忽略错误）
        if (this._mp) {
          try {
            await Promise.race([
              this._mp.disconnect(),
              new Promise((r) => setTimeout(r, 2000)),
            ])
          } catch {}
          this._mp = null
        }

        const port = this._config?.port || DEFAULT_PORT
        const projectPath = this._config?.projectPath || ''
        const cliPath = this._config?.cliPath || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

        // 优先 connect（DevTools 可能还在运行）
        const portAlive = await probePort(port, 1000)
        let mp: any = null
        if (portAlive) {
          const connectTimeout = this._config?.connectTimeout || DEFAULT_TIMEOUTS.connect
          mp = await withTimeout(
            automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` } as any),
            connectTimeout,
            'ConnectionManager reconnect: connect'
          )
          console.error(`ConnectionManager: reconnected via connect (port ${port}, backoff was ${this._backoffMs}ms)`)
        } else {
          // launch 新 DevTools
          const disableGpu = this._config?.disableGpu !== false
          const launchArgs = disableGpu ? ['--disable-gpu'] : []
          const launchTimeout = this._config?.launchTimeout || DEFAULT_TIMEOUTS.launch
          mp = await withTimeout(
            automator.launch({
              projectPath,
              cliPath,
              port,
              args: launchArgs,
              timeout: launchTimeout,
            }),
            launchTimeout,
            'ConnectionManager reconnect: launch'
          )
          console.error(`ConnectionManager: reconnected via launch (port ${port}, backoff was ${this._backoffMs}ms)`)
        }

        // ── 重连后立即验证 WS 存活 ──
        // launch 后需要给 DevTools 一点时间加载小程序运行时，
        // 否则 evaluate(()=>true) 可能因运行时未就绪而失败。
        await new Promise((r) => setTimeout(r, 3000))
        try {
          await withTimeout(
            Promise.resolve(mp.evaluate(() => true)),
            5000,
            'ConnectionManager: post-reconnect verify'
          )
        } catch {
          // 重连"成功"但 WS 认证失败（例如 DevTools 项目未完全加载）
          throw new Error('WS alive but miniprogram runtime not ready — may need warm-up')
        }

        this._resetFailureTracking()
        return mp
      } catch (e: any) {
        this._consecutiveFailures++
        this._lastReconnectError = e.message || 'unknown'
        if (!this._failingSinceMs) {
          this._failingSinceMs = Date.now()
        }
        const status = this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? 'BROKEN' : 'degraded'
        console.error(
          `ConnectionManager: reconnect #${this._consecutiveFailures} failed (${status}) — ${e.message}, retrying in ${this._backoffMs}ms`
        )
        await new Promise((r) => setTimeout(r, this._backoffMs))
        this._backoffMs = Math.min(this._backoffMs * 2, this._maxBackoff)
      }
    }
  }

  /** 重置失败追踪（连接成功或 ping 成功时调用） */
  private _resetFailureTracking(): void {
    if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error('ConnectionManager: recovered from BROKEN state!')
    }
    this._consecutiveFailures = 0
    this._lastReconnectError = null
    this._failingSinceMs = null
    this._backoffMs = 1000
  }
}

/** 全局单例 */
let _instance: ConnectionManager | null = null

export function getConnectionManager(): ConnectionManager {
  if (!_instance) {
    _instance = new ConnectionManager()
  }
  return _instance
}

export function resetConnectionManager(): void {
  if (_instance) {
    _instance.dispose().catch(() => {})
    _instance = null
  }
}
