/**
 * MiniProgram Capability Module
 *
 * Provides tools for mini program-level operations including navigation,
 * WeChat API calls, JavaScript evaluation, screenshots, and system info.
 */

import type { CapabilityModule, ToolDefinition } from '../registry.js'
import {
  navigateSchema,
  callWxSchema,
  evaluateSchema,
  screenshotSchema,
  pageStackSchema,
  systemInfoSchema,
  healthSchema,
  confirmModalSchema,
  cancelModalSchema,
  logsSchema,
} from './schemas/index.js'
import {
  navigate,
  callWx,
  evaluate,
  screenshot,
  getPageStack,
  getSystemInfo,
  getHealth,
  confirmModal,
  cancelModal,
  getLogs,
} from './handlers/index.js'

// Re-export schemas for external use
export * from './schemas/index.js'

// Re-export handlers for external use
export * from './handlers/index.js'

/**
 * MiniProgram tool definitions
 */
const tools: ToolDefinition[] = [
  {
    name: 'miniprogram_navigate',
    description:
      'Navigate to a page using various navigation methods (navigateTo, redirectTo, reLaunch, switchTab, navigateBack)',
    capability: 'miniprogram',
    inputSchema: navigateSchema,
    handler: navigate,
  },
  {
    name: 'miniprogram_call_wx',
    description: 'Call a WeChat API method (wx.*) in the mini program',
    capability: 'miniprogram',
    inputSchema: callWxSchema,
    handler: callWx,
  },
  {
    name: 'miniprogram_evaluate',
    description: 'Evaluate JavaScript code in the mini program context',
    capability: 'miniprogram',
    inputSchema: evaluateSchema,
    handler: evaluate,
  },
  {
    name: 'miniprogram_screenshot',
    description:
      '截取小程序全页截图（自动拼接滚动内容为一张完整图片）。默认保存到小程序项目根目录的 ai_tmp/ 下，文件名自动生成。也可通过 filename 参数指定自定义文件名。',
    capability: 'miniprogram',
    inputSchema: screenshotSchema,
    handler: screenshot,
  },
  {
    name: 'miniprogram_get_page_stack',
    description: 'Get the current page stack',
    capability: 'miniprogram',
    inputSchema: pageStackSchema,
    handler: getPageStack,
  },
  {
    name: 'miniprogram_get_system_info',
    description: 'Get system information',
    capability: 'miniprogram',
    inputSchema: systemInfoSchema,
    handler: getSystemInfo,
  },

  {
    name: 'miniprogram_health',
    description: '全面的健康检查 — WS 连通性、登录状态、全链路（云函数→后端）、GPU 状态',
    capability: 'miniprogram',
    inputSchema: healthSchema,
    handler: getHealth,
  },
  {
    name: 'miniprogram_native_confirm_modal',
    description:
      '点击微信原生模态弹窗（wx.showModal）的「确定」按钮。需要弹窗已显示（通常由前置操作触发），否则 DevTools 会拒绝请求。',
    capability: 'miniprogram',
    inputSchema: confirmModalSchema,
    handler: confirmModal,
  },
  {
    name: 'miniprogram_native_cancel_modal',
    description:
      '点击微信原生模态弹窗（wx.showModal）的「取消」按钮。需要弹窗已显示（通常由前置操作触发），否则 DevTools 会拒绝请求。',
    capability: 'miniprogram',
    inputSchema: cancelModalSchema,
    handler: cancelModal,
  },
  {
    name: 'miniprogram_get_logs',
    description:
      '读取小程序运行时日志（DevTools 模拟器自动落盘）。零参数调用返回最近 5 分钟的 error 日志。支持按时间范围、日志级别（log/info/warn/error）、关键字过滤。',
    capability: 'miniprogram',
    inputSchema: logsSchema,
    handler: getLogs,
  },
]

/**
 * MiniProgram capability module
 */
export const capability: CapabilityModule = {
  name: 'miniprogram',
  description: 'Mini program-level operations (10 tools)',
  tools,
}

export default capability
