/**
 * Native modal schemas — confirm / cancel buttons on wx.showModal
 */

import { z } from 'zod'

export const confirmModalSchema = z
  .object({})
  .describe('点击微信原生模态弹窗（wx.showModal）的「确定」按钮')

export const cancelModalSchema = z
  .object({})
  .describe('点击微信原生模态弹窗（wx.showModal）的「取消」按钮')
