/**
 * Logs schema - Retrieve Mini Program runtime logs from DevTools simulator
 *
 * The WeChat DevTools simulator automatically persists Mini Program console
 * output to disk at:
 *   ~/Library/.../WeappSimulator/WeappFileSystem/<openid>/<appid>/usr/miniprogramLog/
 *
 * This tool reads those files directly — no SDK streaming or pre-buffering needed.
 */

import { z } from 'zod'

const LOG_LEVELS = ['log', 'info', 'warn', 'error'] as const

export const logsSchema = z
  .object({
    level: z
      .union([z.enum(LOG_LEVELS), z.array(z.enum(LOG_LEVELS))])
      .optional()
      .default('error')
      .describe(
        '过滤日志级别："log" | "info" | "warn" | "error"，支持单值或数组。默认 "error"。'
      ),

    keyword: z
      .string()
      .max(500)
      .optional()
      .describe('关键字搜索（大小写不敏感，匹配整条消息文本）。'),

    since: z
      .string()
      .optional()
      .default('5m')
      .describe(
        '起始时间。"5m"=最近5分钟 / "30s"=最近30秒 / ISO 8601 / epoch 毫秒。默认 "5m"。'
      ),

    until: z
      .string()
      .optional()
      .describe('截止时间（ISO 8601 或 epoch 毫秒）。不传则无上限。'),

    limit: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .default(200)
      .describe('返回条数上限（1-10000），默认 200。最新日志优先。'),

    file: z
      .enum(['auto', 'log1', 'log2'])
      .optional()
      .default('auto')
      .describe('指定日志文件名。"auto"=自动选最新。'),
  })
  .describe(
    '读取小程序运行时日志（模拟器自动落盘）。\n' +
      '零参数调用直接返回最近 5 分钟的 error 级别日志。\n' +
      '支持按时间范围、级别、关键字过滤。'
  )
