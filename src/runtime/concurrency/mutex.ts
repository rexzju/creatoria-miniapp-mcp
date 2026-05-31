/**
 * Per-key serial queue (mutex).
 *
 * The WeChat automation SDK uses a single WebSocket with a serial request/response
 * protocol. Operations like screenshot cannot run concurrently — firing several at
 * once makes all but one hang until they time out. This mutex serializes calls that
 * share a key (e.g. a session id) so concurrent callers are queued instead of racing.
 */

const tails = new Map<string, Promise<unknown>>()

/**
 * Run `task` exclusively for the given `key`. Calls with the same key execute one at a
 * time, in arrival order. Calls with different keys do not block each other.
 *
 * @param key - Serialization key (e.g. session id)
 * @param task - The async operation to run under the lock
 */
export async function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve()

  // Chain after the predecessor, ignoring its outcome so one caller's error
  // never rejects the next caller in the queue.
  const run = prev.then(
    () => task(),
    () => task()
  )

  // Advance the tail. Settle to a non-throwing promise so the chain stays clean.
  const settled = run.then(
    () => undefined,
    () => undefined
  )
  tails.set(key, settled)

  // Drop the entry once this task is the last one, to avoid unbounded growth.
  settled.then(() => {
    if (tails.get(key) === settled) tails.delete(key)
  })

  return run
}

/**
 * Serialize an operation against all other operations on the same session.
 *
 * The SDK multiplexes every request over ONE WebSocket. Running independent
 * operations (screenshot, evaluate, navigate, …) concurrently makes them race for
 * that single connection and all but one hang until timeout. Sharing one lock per
 * session turns concurrent calls into an orderly queue.
 *
 * @param sessionId - The session whose SDK operations must run one at a time
 * @param task - The async SDK operation to run under the session lock
 */
export function withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  return runExclusive(`session:${sessionId}`, task)
}
