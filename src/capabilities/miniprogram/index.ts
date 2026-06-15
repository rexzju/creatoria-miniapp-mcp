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
} from './schemas/index.js'
import {
  navigate,
  callWx,
  evaluate,
  screenshot,
  getPageStack,
  getSystemInfo,
  getHealth,
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
      'Take a full-page screenshot of the mini program. Automatically captures scrollable content (scroll-view) into a single image. Provide filename to save to file, or leave blank for auto-generated name.',
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
]

/**
 * MiniProgram capability module
 */
export const capability: CapabilityModule = {
  name: 'miniprogram',
  description: 'Mini program-level operations (7 tools)',
  tools,
}

export default capability
