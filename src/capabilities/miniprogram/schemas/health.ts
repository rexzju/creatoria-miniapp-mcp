import { z } from 'zod'

export const healthSchema = z.object({}).describe('Health check parameters (empty)')
