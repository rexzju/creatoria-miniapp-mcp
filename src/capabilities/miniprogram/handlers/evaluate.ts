/**
 * Evaluate handler - Execute JavaScript in mini program context
 *
 * Supports three input modes (priority: function > body > expression):
 *
 *   1. expression  — raw JavaScript string (with defensive auto-repair)
 *   2. functionPath — named function path + structured args (NO quoting issues)
 *   3. body        — arrow function body + structured args
 *
 * ⚠️ SECURITY WARNING:
 * This tool executes arbitrary JavaScript code in the mini program context.
 * Use with caution:
 * - All evaluations are logged for audit
 * - Evaluations are limited by timeout (default: 5s)
 * - Consider restricting this tool in production environments
 * - Never pass untrusted user input directly to this function
 */

import type { SessionState } from '../../../types.js'
import { withTimeout, getTimeout, DEFAULT_TIMEOUTS } from '../../../runtime/timeout/timeout.js'
import { withSessionLock } from '../../../runtime/concurrency/mutex.js'

/**
 * Evaluate input arguments
 *
 * At least one of `expression`, `functionPath`, or `body` must be provided.
 * When multiple are given, priority is: functionPath > body > expression.
 *
 * Note: The `args` field additionally accepts a JSON-stringified array at
 * the MCP transport layer (coerced by Zod preprocessing). Direct TypeScript
 * callers should always pass `any[]`.
 */
export interface EvaluateArgs {
  /** Raw JavaScript expression or function to evaluate */
  expression?: string
  /** Named function path to call (e.g. "wx.setStorageSync", "console.log") */
  functionPath?: string
  /** Arrow function body (e.g. "k => k * 2") */
  body?: string
  /** Arguments to pass (also accepts JSON-stringified array via MCP transport) */
  args?: any[]
}

/**
 * Evaluate result
 */
export interface EvaluateResult {
  success: boolean
  message: string
  result?: any
}

// ---------------------------------------------------------------------------
// Expression composition
// ---------------------------------------------------------------------------

/**
 * Regex that matches a JS function declaration at the start of a string.
 *
 * Covers:
 *   - function() { }         — traditional anonymous
 *   - function foo() { }     — traditional named
 *   - async function() { }   — async traditional
 *   - () => expr             — arrow, no params
 *   - (a, b) => expr         — arrow, parenthesized params
 *   - a => expr              — arrow, single-identifier param
 *   - async () => expr       — async arrow
 *   - async a => expr        — async arrow, single param
 *
 * IMPORTANT: the single-identifier pattern uses `[a-zA-Z_$]\w*` rather than
 * `\S*` to avoid false-positives where `=>` appears INSIDE an expression
 * (e.g. `["a"].forEach(k=>k)`).  False-positives are dangerous because they
 * cause the bare code to reach DevTools without wrapping and fail.
 */
const FN_DECL_RE =
  /^\s*(async\s*)?(function\s*\(|function\s+\w+\s*\(|\(\)\s*=>|\([^)]*\)\s*=>|[a-zA-Z_$]\w*\s*=>)/

function isFunctionDeclaration(code: string): boolean {
  return FN_DECL_RE.test(code.trim())
}

/**
 * Heuristic to detect JavaScript code that contains statements rather than a
 * single expression.  Such code cannot be wrapped in an expression-body arrow
 * `() => (code)` because arrow expression bodies only accept a single
 * expression, not statements.
 *
 * Detects:
 *   - Statement separators (`;` not inside quote delimiters — best-effort)
 *   - Statement-introducing keywords at the start
 */
const STATEMENT_KEYWORD_RE = /^(var|let|const|if|for|while|switch|try|return|throw|class|import|export|debugger)\b/

function needsBlockBody(code: string): boolean {
  const trimmed = code.trim()
  // Semicolons anywhere suggest multiple statements
  if (/;/.test(trimmed)) return true
  // Statement-introducing keywords at the beginning
  if (STATEMENT_KEYWORD_RE.test(trimmed)) return true
  return false
}

/**
 * Compose the final JavaScript expression and eval-args from the three
 * input modes.
 *
 * Priority: functionPath > body > expression
 *
 * ## Why auto-wrapping is necessary
 *
 * The WeChat DevTools App.callFunction WebSocket RPC requires
 * `functionDeclaration` to be a **callable function** — either an arrow
 * `(…) => …` or a traditional `function(…) { … }`.  Bare expressions like
 * `1+1` or `wx.setStorageSync('k', true)` are rejected by DevTools with
 * "Unexpected number" / "Arg string terminates parameters early".
 *
 * ## Wrapping strategy for expression mode
 *
 *   - Already a function declaration → pass through as-is
 *   - Single expression (no `;`, no statement keywords) → `() => (expr)`
 *     (expression-body arrow that returns the value)
 *   - Multi-statement code (contains `;` or starts with statement keyword)
 *     → `function() { code }`  (block-body traditional function;
 *       returns undefined unless the user writes an explicit `return`)
 */
function resolveExpression(args: EvaluateArgs): {
  expression: string
  evalArgs: any[]
  mode: 'functionPath' | 'body' | 'expression'
} {
  const evalArgs: any[] = args.args ?? []

  // ── Mode 2: structured function call ──
  if (args.functionPath) {
    const funcPath = args.functionPath
    // Arrow function spread-wrapper — do NOT wrap in outer parens.
    // DevTools rejects `((..._a) => ...)` but accepts `(..._a) => ...`.
    const expression = `(..._a) => ${funcPath}(..._a)`
    return { expression, evalArgs, mode: 'functionPath' }
  }

  // ── Mode 3: arrow function body ──
  if (args.body) {
    return { expression: args.body, evalArgs, mode: 'body' }
  }

  // ── Mode 1: raw expression ──
  let expression = args.expression!
  if (!isFunctionDeclaration(expression)) {
    if (needsBlockBody(expression)) {
      // Multi-statement code — needs a block body.
      // Loses implicit return, but the only safe wrapper for statements.
      expression = `function() { ${expression} }`
    } else {
      // Single expression — wrap in expression-body arrow.
      // Returns the value of the expression.
      expression = `() => (${expression})`
    }
  }
  return { expression, evalArgs, mode: 'expression' }
}

// ---------------------------------------------------------------------------
// Evaluate entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate JavaScript code in the mini program context
 */
export async function evaluate(session: SessionState, args: EvaluateArgs): Promise<EvaluateResult> {
  // Serialize against all other SDK operations on this session (shared single WebSocket).
  return withSessionLock(session.sessionId, () => evaluateImpl(session, args))
}

async function evaluateImpl(session: SessionState, args: EvaluateArgs): Promise<EvaluateResult> {
  const { expression, evalArgs, mode } = resolveExpression(args)
  const logger = session.logger

  try {
    if (!session.miniProgram) {
      throw new Error(
        'MiniProgram not connected. Call miniprogram_launch or miniprogram_connect first.'
      )
    }

    // Security: Log all evaluate calls for audit (with truncated args)
    const argsPreview =
      evalArgs.length > 0
        ? JSON.stringify(evalArgs).substring(0, 500) +
          (JSON.stringify(evalArgs).length > 500 ? '…' : '')
        : '(none)'
    logger?.info('[SECURITY] Evaluating expression', {
      mode,
      expression,
      argsCount: evalArgs.length,
      argsPreview,
      timestamp: new Date().toISOString(),
    })

    // Get timeout from config or use default (5 seconds for evaluate)
    const timeoutMs = getTimeout(session.config?.evaluateTimeout, DEFAULT_TIMEOUTS.evaluate)

    // Evaluate expression with timeout protection
    const result = await withTimeout(
      session.miniProgram.evaluate(expression, ...evalArgs),
      timeoutMs,
      'Evaluate expression'
    )

    logger?.info('Evaluation successful', { mode, result })

    return {
      success: true,
      message: `Expression evaluated successfully (mode: ${mode})`,
      result,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Security: Log failed evaluations
    logger?.error('[SECURITY] Evaluation failed', {
      error: errorMessage,
      mode,
      expression,
      timestamp: new Date().toISOString(),
    })

    throw new Error(`Evaluation failed (mode: ${mode}): ${errorMessage}`)
  }
}
