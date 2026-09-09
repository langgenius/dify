import { createStore } from 'jotai/vanilla'
import {
  createParser,
  debounce,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  throttle,
} from 'nuqs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { parseValues, prepareUpdate } from './query'
import { createQueryRuntime } from './runtime'
import { createMemoryQueryAdapter } from './testing'

const parsers = {
  query: parseAsString.withDefault('').withOptions({ limitUrlUpdates: debounce(300) }),
  filter: parseAsStringLiteral(['all', 'ready'])
    .withDefault('all')
    .withOptions({ history: 'push' }),
  upload: parseAsStringLiteral(['1']),
  page: parseAsInteger.withDefault(1),
}

function setup(url = 'http://localhost/documents?other=keep#anchor') {
  const onUpdate = vi.fn()
  const adapter = createMemoryQueryAdapter(url, onUpdate)
  const runtime = createQueryRuntime(adapter)
  const store = createStore()
  const stop = runtime.connect(store)
  const disconnect = () => {
    stop()
    runtime.dispose()
  }
  const write = (
    patch: Parameters<typeof prepareUpdate<typeof parsers>>[2],
    options?: Parameters<typeof prepareUpdate<typeof parsers>>[4],
  ) => runtime.write(() => prepareUpdate(parsers, { filter: 'status' }, patch, {}, options), store)
  return { adapter, runtime, store, write, onUpdate, disconnect }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('page URL transactions', () => {
  it('publishes a search immediately and commits it after 300ms', async () => {
    const { store, runtime, write, adapter, onUpdate } = setup()
    const result = write({ query: 'jotai' })
    expect(
      parseValues(
        parsers,
        { filter: 'status' },
        new URL(store.get(runtime.stateAtom).href).searchParams,
      ).query,
    ).toBe('jotai')
    await vi.advanceTimersByTimeAsync(299)
    expect(onUpdate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).get('query')).toBe('jotai')
    expect(adapter.read().hash).toBe('#anchor')
    expect(adapter.read().searchParams.get('other')).toBe('keep')
  })

  it('pushes a filter without flushing a different key debounce', async () => {
    const { write, adapter, onUpdate } = setup()
    const search = write({ query: 'jotai' })
    await vi.advanceTimersByTimeAsync(100)
    const filter = write({ filter: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    await filter
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(adapter.read().searchParams.get('query')).toBeNull()
    expect(adapter.read().searchParams.get('status')).toBe('ready')
    await vi.advanceTimersByTimeAsync(200)
    await search
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(adapter.read().searchParams.get('query')).toBe('jotai')
    adapter.back()
    expect(adapter.read().searchParams.get('query')).toBeNull()
    expect(adapter.read().searchParams.get('status')).toBeNull()
    adapter.forward()
    expect(adapter.read().searchParams.get('query')).toBe('jotai')
    expect(adapter.read().searchParams.get('status')).toBe('ready')
  })

  it('commits an overlay while search is still debounced', async () => {
    const { write, adapter, onUpdate } = setup()
    const search = write({ query: 'jotai' })
    const overlay = write({ upload: '1' })
    await vi.advanceTimersByTimeAsync(0)
    await overlay
    expect(adapter.read().searchParams.get('query')).toBeNull()
    expect(adapter.read().searchParams.get('upload')).toBe('1')
    await vi.runAllTimersAsync()
    await search
    expect(adapter.read().searchParams.get('query')).toBe('jotai')
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it('cancels pending search on back, including a traversal to the same URL', async () => {
    const { write, adapter, store, runtime, onUpdate } = setup()
    adapter.navigate(adapter.read().href)
    const pending = write({ query: 'old draft' })
    adapter.back()
    await vi.runAllTimersAsync()
    expect((await pending).get('query')).toBeNull()
    expect(
      parseValues(
        parsers,
        { filter: 'status' },
        new URL(store.get(runtime.stateAtom).href).searchParams,
      ).query,
    ).toBe('')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('cancels old work on a cross-page navigation and rejects writes after disposal', async () => {
    const { write, adapter, onUpdate, disconnect } = setup()
    const pending = write({ query: 'old draft' })
    adapter.navigate('/other-space/documents?query=new')
    await vi.runAllTimersAsync()
    expect((await pending).get('query')).toBe('new')
    expect(onUpdate).not.toHaveBeenCalled()
    disconnect()
    expect(() => write({ query: 'late' })).toThrow(/outside their mounted provider/)
  })

  it('merges with unrelated external writes using the latest URL', async () => {
    const { write, adapter } = setup()
    const pending = write({ query: 'jotai' })
    const external = adapter.read()
    external.searchParams.set('settings', 'profile')
    adapter.write(external, { history: 'replace', shallow: true, scroll: false })
    await vi.runAllTimersAsync()
    await pending
    expect(adapter.read().searchParams.get('settings')).toBe('profile')
    expect(adapter.read().searchParams.get('query')).toBe('jotai')
  })

  it('rolls back optimistic state and exposes a failed commit', async () => {
    const { write, adapter, store, runtime } = setup()
    const failure = new Error('History write failed')
    vi.spyOn(adapter, 'write').mockImplementation(() => {
      throw failure
    })
    const pending = write({ page: 2 })
    const rejected = expect(pending).rejects.toBe(failure)
    await vi.runAllTimersAsync()
    await rejected
    expect(
      parseValues(
        parsers,
        { filter: 'status' },
        new URL(store.get(runtime.stateAtom).href).searchParams,
      ).page,
    ).toBe(1)
    expect(store.get(runtime.errorAtom)).toBe(failure)
  })

  it('falls back for invalid parameters, supports reset, and does not rewrite on read', async () => {
    const { write, adapter, store, runtime, onUpdate } = setup(
      'http://localhost/documents?status=invalid&page=oops&other=keep',
    )
    expect(
      parseValues(
        parsers,
        { filter: 'status' },
        new URL(store.get(runtime.stateAtom).href).searchParams,
      ),
    ).toMatchObject({ filter: 'all', page: 1 })
    expect(onUpdate).not.toHaveBeenCalled()
    const pending = write(null)
    await vi.runAllTimersAsync()
    await pending
    expect(adapter.read().search).toBe('?other=keep')
  })

  it('preserves a pending draft when a later update cannot be serialized', async () => {
    const { write, runtime, store, adapter, onUpdate } = setup()
    const pending = write({ query: 'draft' })
    const failure = new Error('Cannot serialize')
    const parser = createParser({
      parse: String,
      serialize: () => {
        throw failure
      },
    })
    expect(() =>
      runtime.write(
        () => prepareUpdate({ query: parser }, undefined, { query: 'invalid' }, {}),
        store,
      ),
    ).toThrow(failure)
    expect(new URL(store.get(runtime.stateAtom).href).searchParams.get('query')).toBe('draft')
    await vi.runAllTimersAsync()
    expect((await pending).get('query')).toBe('draft')
    expect(adapter.read().searchParams.get('query')).toBe('draft')
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('retains non-shallow navigation options for a composite update', async () => {
    const { write, onUpdate } = setup()
    const pending = write({ query: 'record', page: 2 }, { history: 'push', shallow: false })
    await vi.runAllTimersAsync()
    await pending
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate.mock.calls[1]![0].options).toEqual({
      history: 'push',
      shallow: false,
      scroll: false,
    })
  })
})

it('continues on the next pathname without remounting the URL provider', async () => {
  const { write, adapter, onUpdate } = setup()
  const old = write({ query: 'abandoned' })
  adapter.navigate('/another-space/documents?other=keep')
  const next = write({ query: 'new search' })
  await vi.runAllTimersAsync()
  expect((await old).get('query')).toBeNull()
  expect((await next).get('query')).toBe('new search')
  expect(adapter.read().pathname).toBe('/another-space/documents')
  expect(onUpdate).toHaveBeenCalledOnce()
})

describe('URL rate limiting', () => {
  it.each(['replace', 'push'] as const)(
    'commits continuous throttled %s updates without postponing the deadline',
    async (history) => {
      const { write, onUpdate } = setup()
      const pending: Promise<URLSearchParams>[] = []
      for (let page = 2; page <= 7; page++) {
        pending.push(write({ page }, { history, limitUrlUpdates: throttle(100) }))
        await vi.advanceTimersByTimeAsync(50)
      }
      expect(onUpdate.mock.calls.map(([event]) => event.searchParams.get('page'))).toEqual([
        '2',
        '3',
        '5',
        '7',
      ])
      await Promise.all(pending)
    },
  )

  it('restarts only the debounce deadline while typing', async () => {
    const { write, onUpdate } = setup()
    const first = write({ query: 'a' })
    await vi.advanceTimersByTimeAsync(200)
    const second = write({ query: 'ab' })
    await vi.advanceTimersByTimeAsync(299)
    expect(onUpdate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([first, second])
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0]![0].searchParams.get('query')).toBe('ab')
  })

  it('does not let a later debounced key join an earlier throttle batch', async () => {
    const { write, onUpdate } = setup()
    const initial = write({ page: 2 })
    await vi.advanceTimersByTimeAsync(0)
    await initial
    onUpdate.mockClear()
    const page = write({ page: 3 }, { limitUrlUpdates: throttle(100) })
    await vi.advanceTimersByTimeAsync(50)
    const search = write({ query: 'jotai' })
    await vi.advanceTimersByTimeAsync(50)
    await page
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0]![0].searchParams.get('query')).toBeNull()
    await vi.advanceTimersByTimeAsync(250)
    await search
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate.mock.calls[1]![0].searchParams.get('query')).toBe('jotai')
  })

  it('respects the browser interval independently of debounce deadlines', async () => {
    const { write, adapter, onUpdate } = setup()
    Object.assign(adapter, { minimumInterval: 400 })
    const initial = write({ page: 2 })
    await vi.advanceTimersByTimeAsync(0)
    await initial
    const search = write({ query: 'first' })
    await vi.advanceTimersByTimeAsync(200)
    const nextSearch = write({ query: 'latest' })
    const filter = write({ filter: 'ready' })
    await vi.advanceTimersByTimeAsync(199)
    expect(onUpdate).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    await filter
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate.mock.calls[1]![0].searchParams.get('query')).toBeNull()
    expect(onUpdate.mock.calls[1]![0].options.history).toBe('push')
    await vi.advanceTimersByTimeAsync(399)
    expect(onUpdate).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([search, nextSearch])
    expect(onUpdate).toHaveBeenCalledTimes(3)
    expect(onUpdate.mock.calls[2]![0].searchParams.get('query')).toBe('latest')
  })
})

it.each(['navigate', 'dispose'] as const)(
  'settles a write cancelled synchronously by a %s subscriber',
  async (action) => {
    const { runtime, store, adapter, write, onUpdate } = setup()
    const settled = vi.fn()
    let cancelled = false
    const stop = store.sub(runtime.stateAtom, () => {
      if (cancelled) return
      cancelled = true
      if (action === 'navigate') adapter.navigate('/next?query=destination')
      else runtime.dispose()
    })
    const pending = write({ query: 'draft' }).then(settled)
    await vi.runAllTimersAsync()
    expect(settled).toHaveBeenCalledOnce()
    expect(settled.mock.calls[0]![0].toString()).toBe(
      action === 'navigate' ? 'query=destination' : 'other=keep',
    )
    expect(onUpdate).not.toHaveBeenCalled()
    await pending
    stop()
  },
)

it('preserves a new write issued by a subscriber after cancelling the old batch', async () => {
  const { runtime, store, adapter, write, onUpdate } = setup()
  let navigated = false
  let next: Promise<URLSearchParams> | undefined
  const stop = store.sub(runtime.stateAtom, () => {
    if (navigated) return
    navigated = true
    adapter.navigate('/next')
    next = write({ query: 'next draft' })
  })
  const settled = vi.fn()
  const previous = write({ page: 2 }).then(settled)
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledOnce()
  expect(onUpdate).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300)
  await previous
  expect((await next)?.get('query')).toBe('next draft')
  expect(onUpdate).toHaveBeenCalledOnce()
  stop()
})

it.each([
  { delay: 100, minimum: 0, history: 'replace' as const },
  { delay: 100, minimum: 0, history: 'push' as const },
  { delay: 800, minimum: 400, history: 'replace' as const },
  { delay: 800, minimum: 400, history: 'push' as const },
])(
  'retains throttle($delay) in a mixed patch ($history, browser interval $minimum)',
  async ({ delay, minimum, history }) => {
    const { runtime, store, adapter, write, onUpdate } = setup()
    Object.assign(adapter, { minimumInterval: minimum })
    const initial = write({ page: 2 })
    await vi.advanceTimersByTimeAsync(0)
    await initial
    onUpdate.mockClear()
    const mixed = {
      query: parseAsString.withOptions({ limitUrlUpdates: debounce(300) }),
      page: parseAsInteger.withOptions({ limitUrlUpdates: throttle(delay) }),
    }
    const pending = runtime.write(
      () => prepareUpdate(mixed, undefined, { query: 'draft', page: 3 }, {}, { history }),
      store,
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(onUpdate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(onUpdate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(adapter.read().searchParams.get('page')).toBe('3')
    if (delay < 300) expect(adapter.read().searchParams.get('query')).toBeNull()
    await vi.runAllTimersAsync()
    expect((await pending).get('query')).toBe('draft')
  },
)

it.each(['traversal', 'replace'] as const)(
  'cancels a callback draft on external %s during a commit',
  async (navigation) => {
    const { write, adapter, runtime, store, onUpdate } = setup()
    let draft: Promise<URLSearchParams> | undefined
    onUpdate.mockImplementationOnce(() => {
      draft = write({ page: 3 })
      if (navigation === 'traversal') adapter.navigate('/documents?page=9')
      else
        adapter.write(new URL('http://localhost/documents?page=9'), {
          history: 'replace',
          shallow: true,
          scroll: false,
        })
    })
    const initial = write({ page: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(new URL(store.get(runtime.stateAtom).href).searchParams.get('page')).toBe('9')
    await vi.runAllTimersAsync()
    await initial
    expect((await draft)?.get('page')).toBe('9')
    expect(adapter.read().searchParams.get('page')).toBe('9')
  },
)

it('enforces the browser interval for writes queued inside a commit callback', async () => {
  const { write, adapter, onUpdate } = setup()
  Object.assign(adapter, { minimumInterval: 400 })
  const timestamps: number[] = []
  let draft: Promise<URLSearchParams> | undefined
  onUpdate.mockImplementation(() => {
    timestamps.push(Date.now())
    if (timestamps.length === 1) draft = write({ page: 3 })
  })
  const initial = write({ page: 2 })
  await vi.advanceTimersByTimeAsync(0)
  await initial
  await vi.advanceTimersByTimeAsync(399)
  expect(timestamps).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(timestamps).toHaveLength(2)
  expect(timestamps[1]! - timestamps[0]!).toBe(400)
  expect((await draft)?.get('page')).toBe('3')
})

it('settles all keys after a partially committed composite is cancelled', async () => {
  const { write, adapter, onUpdate } = setup()
  const settled = vi.fn()
  const result = write({ page: 2, query: 'draft' }).then(settled)
  await vi.advanceTimersByTimeAsync(0)
  expect(onUpdate).toHaveBeenCalledOnce()
  expect(adapter.read().searchParams.get('page')).toBe('2')
  expect(settled).not.toHaveBeenCalled()
  adapter.navigate('/documents?page=9')
  await vi.runAllTimersAsync()
  await result
  expect(settled).toHaveBeenCalledOnce()
  expect(settled.mock.calls[0]![0].get('page')).toBe('9')
  expect(onUpdate).toHaveBeenCalledOnce()
})

it('rejects a composite if a later debounced commit fails', async () => {
  const { write, adapter, store, runtime } = setup()
  const result = write({ page: 2, query: 'draft' })
  await vi.advanceTimersByTimeAsync(0)
  const failure = new Error('second commit failed')
  vi.spyOn(adapter, 'write').mockImplementation(() => {
    throw failure
  })
  const rejected = expect(result).rejects.toBe(failure)
  await vi.runAllTimersAsync()
  await rejected
  expect(adapter.read().searchParams.get('page')).toBe('2')
  expect(adapter.read().searchParams.has('query')).toBe(false)
  expect(store.get(runtime.errorAtom)).toBe(failure)
  expect(new URL(store.get(runtime.stateAtom).href).searchParams.has('query')).toBe(false)
})

it('resumes an infinite throttle batch when another key requests a finite write', async () => {
  const { write, adapter, onUpdate } = setup()
  const local = write({ page: 2 }, { limitUrlUpdates: throttle(Infinity), shallow: false })
  await vi.advanceTimersByTimeAsync(1000)
  expect((await local).get('page')).toBeNull()
  expect(onUpdate).not.toHaveBeenCalled()
  const resumed = write({ filter: 'ready' }, { limitUrlUpdates: throttle(100) })
  await vi.runAllTimersAsync()
  await resumed
  expect(onUpdate).toHaveBeenCalledOnce()
  expect(onUpdate.mock.calls[0]![0].options.shallow).toBe(false)
  expect(adapter.read().searchParams.get('page')).toBe('2')
  expect(adapter.read().searchParams.get('status')).toBe('ready')
})
