/**
 * Screenshot schema - Take a screenshot of the mini program
 * Always captures the full page content, stitching top and bottom if scrollable.
 */

import { z } from 'zod'

export const screenshotSchema = z
  .object({
    filename: z
      .string()
      .optional()
      .describe(
        'Optional filename to save screenshot to file. Auto-generated if not provided.'
      ),
  })
  .describe('Take a full-page screenshot of the mini program')
