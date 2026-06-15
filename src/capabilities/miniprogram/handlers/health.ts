declare const wx: any

import type { SessionState } from '../../../types.js'

export interface HealthResult {
  ws_ok: boolean
  logged_in: boolean
  current_page: string
  fullchain_ok: boolean
  fullchain_error: string | null
  gpu_status: 'ok' | 'unknown' | 'n/a'
  devtools_port: number
  http_port: number
}

export async function getHealth(session: SessionState): Promise<HealthResult> {
  const mp = session.miniProgram
  const config = session.config || {}
  const result: HealthResult = {
    ws_ok: false,
    logged_in: false,
    current_page: '',
    fullchain_ok: false,
    fullchain_error: null,
    gpu_status: 'n/a',
    devtools_port: config.port || 9420,
    http_port: 0,
  }

  if (!mp) {
    result.fullchain_error = 'MiniProgram not connected'
    return result
  }

  // WS 连通性
  try {
    const pageStack = await mp.pageStack()
    result.ws_ok = true
    if (pageStack && pageStack.length > 0) {
      const current = pageStack[pageStack.length - 1]
      result.current_page = current?.path || ''
    }
  } catch (e: any) {
    result.fullchain_error = `WS error: ${e.message}`
    return result
  }

  // 登录检查
  const LOGIN_PATTERNS = ['login', 'auth', 'phone', 'wechat']
  result.logged_in = !LOGIN_PATTERNS.some(
    (p) => result.current_page.toLowerCase().includes(p)
  )

  // GPU 状态
  result.gpu_status = 'ok'

  // 全链路
  try {
    const fc: any = await mp.evaluate(() => {
      return new Promise((resolve) => {
        (wx as any).request({
          url: 'http://localhost:3001/health/fullchain',
          method: 'GET',
          success: (res: any) => {
            resolve({ ok: true, backend_ok: res.data?.backend_ok === true })
          },
          fail: (err: any) => {
            resolve({ ok: false, error: err.errMsg || 'fail' })
          },
        })
      })
    })
    result.fullchain_ok = fc?.ok && fc?.backend_ok === true
    if (!result.fullchain_ok) {
      result.fullchain_error = fc?.error || '后端不可达'
    }
  } catch (e: any) {
    result.fullchain_error = `fullchain evaluate 失败: ${e.message}`
  }

  return result
}
