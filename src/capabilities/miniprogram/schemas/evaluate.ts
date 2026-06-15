/**
 * Evaluate schema - Evaluate JavaScript code in the mini program context
 *
 * Supports three input modes (at least one required):
 *
 *   1. expression (raw JS)  → evaluate("wx.setStorageSync('k', true)")
 *   2. functionPath + args   → evaluate("wx.setStorageSync", "k", true)
 *   3. body + args           → evaluate(k => k * 2, 5)
 *
 * Priority when multiple modes provided: function > body > expression.
 *
 * Defensive preprocessing auto-repairs common upstream serialization
 * bugs (double-encoding, stringified arrays, base64 wrapping) so the
 * tool works even when the MCP client mangles parameters.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Defensive preprocessors — repair common upstream serialization bugs
// ---------------------------------------------------------------------------

/** Max byte length for reparsed JSON arrays (DoS guard). */
const MAX_ARGS_JSON_LENGTH = 100_000

/**
 * Auto-repair JSON-stringified arrays.
 *
 * Known upstream bugs:
 *   - Claude Code #34520 / #5504: HTTP transport double-encodes arrays
 *   - Model non-determinism: LLM wraps array values in quotes
 *
 * Native arrays pass through unchanged; stringified JSON arrays are parsed.
 */
function coerceJsonArray(val: unknown): unknown {
  if (typeof val === 'string') {
    const trimmed = val.trim()
    // DoS guard: refuse to JSON.parse huge payloads
    if (trimmed.length > MAX_ARGS_JSON_LENGTH) return val
    // Only attempt parse for values that look like JSON arrays
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed
      } catch {
        /* pass through to Zod for normal error */
      }
    }
  }
  return val
}

/**
 * Pattern that suggests a string is JavaScript code (not a plain string literal).
 * Used to decide whether to attempt double-encoding repair on a quote-wrapped value.
 */
const JS_CODE_PATTERN = /[.=;{}()[\]]/

/**
 * Auto-repair expression strings corrupted by upstream parameter parsers.
 *
 * Repairs handled:
 *   1. base64: prefix        → expression = "base64:…" → decoded UTF-8
 *   2. Double-serialization  → expression = "\"code\"" → "code"
 *   3. Single-quote wrapping → expression = "'code'"   → "code"  (shell quoting)
 *
 * The double-serialization repair is guarded by heuristics to avoid
 * corrupting legitimate JavaScript string-literal expressions:
 *   - JSON.parse must succeed and return a non-empty string
 *   - The inner string must contain JS-like syntax (operator, parens, etc.)
 *     OR the outer wrapping is single-quotes (not valid JSON, so shell-quote case)
 */
function repairExpression(val: unknown): unknown {
  if (typeof val !== 'string') return val
  const s = val.trim()

  // --- base64: prefix (explicit alternative encoding) ---
  if (s.startsWith('base64:')) {
    try {
      return Buffer.from(s.slice(7), 'base64').toString('utf-8')
    } catch {
      // Bail out — invalid base64, let Zod report the error
      return s
    }
  }

  // --- Single-quote wrapping (shell-style quoting, NOT valid JSON) ---
  // e.g. expression = "'wx.setStorageSync(\"k\", true)'"
  if (s.length >= 3 && s.startsWith("'") && s.endsWith("'")) {
    const inner = s.slice(1, -1)
    // Only unwrap if inner looks like code, not a plain string literal
    if (JS_CODE_PATTERN.test(inner)) {
      return inner
    }
    return s
  }

  // --- Double-quote wrapping (JSON double-serialization) ---
  // e.g. expression = "\"wx.setStorageSync(\\\"k\\\", true)\""
  if (s.length >= 3 && s.startsWith('"') && s.endsWith('"')) {
    try {
      const inner = JSON.parse(s)
      if (
        typeof inner === 'string' &&
        inner.length > 0 &&
        JS_CODE_PATTERN.test(inner) // guard against stripping quotes from legit string literals
      ) {
        return inner
      }
    } catch {
      /* not valid JSON — keep original */
    }
  }

  return s
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const evaluateSchema = z
  .object({
    // ── Mode 1: raw JavaScript expression ──
    expression: z
      .preprocess(repairExpression, z.string().min(1))
      .optional()
      .describe(
        'JavaScript expression or function to evaluate. ' +
          'Supports base64: prefix for explicit encoding. ' +
          'Use functionPath+args mode for calls with string arguments to avoid quoting issues.'
      ),

    // ── Mode 2: structured function call (NO quoting issues) ──
    functionPath: z
      .preprocess(repairExpression, z.string().min(1))
      .optional()
      .describe(
        'Function path to call in the mini program context ' +
          '(e.g. "wx.setStorageSync", "console.log", "Math.max"). ' +
          'Pass arguments via the args parameter. ' +
          'This mode ELIMINATES quoting problems — use it for any call with string literals.'
      ),

    // ── Mode 3: arrow function body (for simple lambdas) ──
    body: z
      .preprocess(repairExpression, z.string().min(1))
      .optional()
      .describe(
        'Arrow function body to execute, e.g. "k => k * 2". ' +
          'Arguments are passed via the args parameter. ' +
          'Best for simple numeric/boolean transformations without string literals.'
      ),

    // ── Common: arguments ──
    args: z
      .preprocess(coerceJsonArray, z.array(z.any()).max(50))
      .optional()
      .describe('Arguments to pass to the expression / functionPath / body (max 50).'),
  })
  .refine(
    (data) => !!(data.expression || data.functionPath || data.body),
    {
      message: 'At least one of expression, functionPath, or body must be provided.',
    }
  )
  .describe('Evaluate JavaScript code in the mini program context')
