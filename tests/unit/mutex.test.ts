/**
 * Unit tests for the per-key serial queue (mutex)
 */

import { runExclusive, withSessionLock } from '../../src/runtime/concurrency/mutex'

/** Resolve after `ms`, recording start/end order via callbacks */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('runExclusive', () => {
  it('runs tasks with the same key one at a time, in arrival order', async () => {
    const events: string[] = []

    const make = (id: string, ms: number) => () =>
      (async () => {
        events.push(`start:${id}`)
        await delay(ms)
        events.push(`end:${id}`)
        return id
      })()

    // Fire three concurrently; B is fastest but must still wait for A.
    const results = await Promise.all([
      runExclusive('k', make('A', 30)),
      runExclusive('k', make('B', 5)),
      runExclusive('k', make('C', 5)),
    ])

    expect(results).toEqual(['A', 'B', 'C'])
    // No interleaving: each start is immediately followed by its own end.
    expect(events).toEqual([
      'start:A',
      'end:A',
      'start:B',
      'end:B',
      'start:C',
      'end:C',
    ])
  })

  it('does not let a failing task reject the next queued task', async () => {
    const order: string[] = []

    const p1 = runExclusive('k', async () => {
      order.push('t1')
      throw new Error('boom')
    })
    const p2 = runExclusive('k', async () => {
      order.push('t2')
      return 'ok'
    })

    await expect(p1).rejects.toThrow('boom')
    await expect(p2).resolves.toBe('ok')
    expect(order).toEqual(['t1', 't2'])
  })

  it('returns the task result/throws the task error to the right caller', async () => {
    await expect(runExclusive('r', async () => 42)).resolves.toBe(42)
    await expect(
      runExclusive('r', async () => {
        throw new Error('specific')
      })
    ).rejects.toThrow('specific')
  })

  it('does not serialize across different keys (parallel keys overlap)', async () => {
    const events: string[] = []
    const make = (id: string, ms: number) => async () => {
      events.push(`start:${id}`)
      await delay(ms)
      events.push(`end:${id}`)
    }

    await Promise.all([
      runExclusive('keyA', make('A', 20)),
      runExclusive('keyB', make('B', 20)),
    ])

    // Both start before either ends → they ran concurrently.
    expect(events.slice(0, 2).sort()).toEqual(['start:A', 'start:B'])
  })

  it('cleans up the internal queue entry after the last task settles', async () => {
    // Run a task, let it fully settle, then a fresh task on the same key should
    // start immediately (no lingering chained promise blocking it).
    await runExclusive('cleanup', async () => 'first')
    await delay(0) // allow the cleanup microtask to run

    const t0 = Date.now()
    await runExclusive('cleanup', async () => 'second')
    // Should be effectively immediate, not waiting on any stale predecessor.
    expect(Date.now() - t0).toBeLessThan(50)
  })
})

describe('withSessionLock', () => {
  it('serializes operations sharing the same session id', async () => {
    const events: string[] = []
    const op = (id: string, ms: number) => () =>
      (async () => {
        events.push(`start:${id}`)
        await delay(ms)
        events.push(`end:${id}`)
      })()

    await Promise.all([
      withSessionLock('s1', op('A', 20)),
      withSessionLock('s1', op('B', 5)),
    ])

    expect(events).toEqual(['start:A', 'end:A', 'start:B', 'end:B'])
  })

  it('does not block operations on different sessions', async () => {
    const events: string[] = []
    const op = (id: string, ms: number) => async () => {
      events.push(`start:${id}`)
      await delay(ms)
      events.push(`end:${id}`)
    }

    await Promise.all([
      withSessionLock('sA', op('A', 20)),
      withSessionLock('sB', op('B', 20)),
    ])

    expect(events.slice(0, 2).sort()).toEqual(['start:A', 'start:B'])
  })
})
