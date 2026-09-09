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
      parseValues(parsers, { filter: 'status' }, new URL(store.get(runtime.stateAtom)).searchParams)
        .query,
    ).toBe('jotai')
    await vi.advanceTimersByTimeAsync(299)
    expect(onUpdate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).get('query')).toBe('jotai')
    expect(adapter.read().hash).toBe('#anchor')
    expect(adapter.read().searchParams.get('other')).toBe('keep')
  })

  it('pushes a pending search and filter as one history entry', async () => {
    const { write, adapter, store, runtime, onUpdate } = setup()
    const search = write({ query: 'jotai' })
    await vi.advanceTimersByTimeAsync(100)
    const filter = write({ filter: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([search, filter])
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(adapter.read().searchParams.get('query')).toBe('jotai')
    expect(adapter.read().searchParams.get('status')).toBe('ready')
    adapter.back()
    expect(
      parseValues(
        parsers,
        { filter: 'status' },
        new URL(store.get(runtime.stateAtom)).searchParams,
      ),
    ).toMatchObject({ query: '', filter: 'all' })
    await vi.advanceTimersByTimeAsync(500)
    expect(onUpdate).toHaveBeenCalledOnce()
    adapter.forward()
    expect(
      parseValues(
        parsers,
        { filter: 'status' },
        new URL(store.get(runtime.stateAtom)).searchParams,
      ),
    ).toMatchObject({ query: 'jotai', filter: 'ready' })
  })

  it('commits an overlay together with the current search', async () => {
    const { write, adapter, onUpdate } = setup()
    const search = write({ query: 'jotai' })
    const overlay = write({ upload: '1' })
    await vi.runAllTimersAsync()
    await Promise.all([search, overlay])
    expect(adapter.read().searchParams.get('query')).toBe('jotai')
    expect(adapter.read().searchParams.get('upload')).toBe('1')
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('cancels pending search on back, including a traversal to the same URL', async () => {
    const { write, adapter, store, runtime, onUpdate } = setup()
    adapter.navigate(adapter.read().href)
    const pending = write({ query: 'old draft' })
    adapter.back()
    await vi.runAllTimersAsync()
    expect((await pending).get('query')).toBeNull()
    expect(
      parseValues(parsers, { filter: 'status' }, new URL(store.get(runtime.stateAtom)).searchParams)
        .query,
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
      parseValues(parsers, { filter: 'status' }, new URL(store.get(runtime.stateAtom)).searchParams)
        .page,
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
        new URL(store.get(runtime.stateAtom)).searchParams,
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
    expect(new URL(store.get(runtime.stateAtom)).searchParams.get('query')).toBe('draft')
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
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0]![0].options).toEqual({
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
      for (let page = 1; page <= 6; page++) {
        pending.push(write({ page }, { history, limitUrlUpdates: throttle(100) }))
        await vi.advanceTimersByTimeAsync(50)
      }
      expect(onUpdate.mock.calls.map(([event]) => event.searchParams.get('page'))).toEqual([
        '2',
        '4',
        '6',
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

  it('does not let a later debounced update postpone a pending throttle', async () => {
    const { write, onUpdate } = setup()
    const page = write({ page: 2 }, { limitUrlUpdates: throttle(100) })
    await vi.advanceTimersByTimeAsync(50)
    const search = write({ query: 'jotai' })
    await vi.advanceTimersByTimeAsync(50)
    expect(onUpdate).toHaveBeenCalledOnce()
    await Promise.all([page, search])
    expect(onUpdate.mock.calls[0]![0].searchParams.get('query')).toBe('jotai')
  })

  it('advances a debounce for an immediate action while respecting the browser interval', async () => {
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
    await Promise.all([search, nextSearch, filter])
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate.mock.calls[1]![0].searchParams.get('query')).toBe('latest')
    expect(onUpdate.mock.calls[1]![0].options.history).toBe('push')
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
    expect((await pending).get('query')).toBe('draft')
    expect(adapter.read().searchParams.get('page')).toBe('3')
  },
)
