import type { Options, SetValues, UseQueryStatesKeysMap, UseQueryStatesOptions, Values } from 'nuqs'
import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import { act, cleanup, render } from '@testing-library/react'
import { useStore } from 'jotai'
import {
  createParser,
  debounce,
  parseAsInteger,
  parseAsIsoDate,
  parseAsString,
  throttle,
  useQueryStates,
} from 'nuqs'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { createQueryGroup, QueryStateProvider } from './index'

// nuqs retains its last-flush timestamp in a module singleton, so keep the
// fake monotonic clock running across cases just as the browser clock does.
beforeAll(() => vi.useFakeTimers())
afterEach(cleanup)
afterAll(() => vi.useRealTimers())

// Run identical consumer expectations against nuqs and the atom bridge.
// This protects the contract when either implementation or nuqs is upgraded.
describe.each(['nuqs', 'atoms'] as const)('%s compatibility', (implementation) => {
  function mount<P extends UseQueryStatesKeysMap>(
    parsers: P,
    search = '',
    options: Partial<UseQueryStatesOptions<P>> = {},
    defaults: Options = {},
  ) {
    const onUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
    let read!: () => Values<P>
    let write!: SetValues<P>
    const queryAtomGroup = createQueryGroup(parsers, options)
    const queryAtom = queryAtomGroup.atom
    function AtomCapture() {
      const store = useStore()
      read = () => store.get(queryAtom)
      write = (...args) => store.set(queryAtom, ...args)
      return null
    }
    function NuqsCapture() {
      const [value, setter] = useQueryStates(parsers, options)
      read = () => value
      write = setter
      return null
    }
    function Wrapper({ query }: { query: string }) {
      return (
        <NuqsTestingAdapter
          hasMemory
          rateLimitFactor={1}
          searchParams={query}
          defaultOptions={defaults}
          onUrlUpdate={onUpdate}
        >
          {implementation === 'atoms' ? (
            <QueryStateProvider groups={[queryAtomGroup]}>
              <AtomCapture />
            </QueryStateProvider>
          ) : (
            <NuqsCapture />
          )}
        </NuqsTestingAdapter>
      )
    }
    const view = render(<Wrapper query={search} />)
    const navigate = (query: string) => view.rerender(<Wrapper query={query} />)
    return {
      read: () => read(),
      write: (...args: Parameters<SetValues<P>>) => {
        let result!: Promise<URLSearchParams>
        act(() => {
          result = write(...args)
        })
        return result
      },
      navigate,
      onUpdate,
    }
  }

  async function advance(time?: number) {
    await act(async () => {
      if (time === undefined) await vi.runAllTimersAsync()
      else await vi.advanceTimersByTimeAsync(time)
    })
  }

  it('retains typed Date values before and after committing a lossy serialization', async () => {
    const { read, write } = mount({ date: parseAsIsoDate })
    const date = new Date('2026-09-09T12:34:56.000Z')
    const first = write({ date })
    expect(read().date).toBe(date)
    await advance()
    expect((await first).get('date')).toBe('2026-09-09')
    expect(read().date).toBe(date)
    // Same URL, different typed value: a href-only atom would miss this update.
    const second = write(({ date }) => ({ date: new Date(date!.getTime() + 3600000) }))
    expect(read().date?.toISOString()).toBe('2026-09-09T13:34:56.000Z')
    await advance()
    await second
    expect(read().date?.toISOString()).toBe('2026-09-09T13:34:56.000Z')
  })

  it('evaluates consecutive functional updates without rounding their state', async () => {
    const parser = createParser({ parse: Number, serialize: (value: number) => value.toFixed(2) })
    const { read, write } = mount({ value: parser })
    const first = write({ value: 1.234 })
    const second = write(({ value }) => ({ value: value! + 0.001 }))
    expect(read().value).toBeCloseTo(1.235, 12)
    await advance()
    await Promise.all([first, second])
    expect(read().value).toBeCloseTo(1.235, 12)
  })

  it('does not parse or replace an object when unrelated URL keys change', async () => {
    const parse = vi.fn((query: string) => JSON.parse(query) as { x: number })
    const parser = createParser({ parse, serialize: JSON.stringify })
    const { read, write, navigate } = mount(
      { data: parser, page: parseAsInteger },
      'payload=%7B%22x%22%3A1%7D',
      { urlKeys: { data: 'payload' } },
    )
    const before = read().data
    parse.mockClear()
    const update = write({ page: 2 })
    await advance()
    await update
    expect(read().data).toBe(before)
    navigate('payload=%7B%22x%22%3A1%7D&page=3')
    expect(read().data).toBe(before)
    expect(parse).not.toHaveBeenCalled()
    navigate('payload=%7B%22x%22%3A2%7D&page=3')
    expect(read().data).toEqual({ x: 2 })
    expect(read().data).not.toBe(before)
    expect(parse).toHaveBeenCalledOnce()
  })

  it('resolves write, parser, factory and provider options in that order', async () => {
    const { write, onUpdate } = mount(
      { q: parseAsString.withOptions({ history: 'push' }) },
      '',
      { history: 'replace', shallow: false },
      { history: 'replace', shallow: true, scroll: true },
    )
    const first = write({ q: 'hello' })
    await advance()
    await first
    expect(onUpdate.mock.calls[0]?.[0].options).toEqual({
      history: 'push',
      shallow: false,
      scroll: true,
    })
    const second = write({ q: 'world' }, { history: 'replace', shallow: true, scroll: false })
    await advance()
    await second
    expect(onUpdate.mock.calls[1]?.[0].options).toEqual({
      history: 'replace',
      shallow: true,
      scroll: false,
    })
  })

  it('uses the longest throttle in a batch relative to the last commit', async () => {
    const { write, onUpdate } = mount({ q: parseAsString })
    const seed = write({ q: 'seed' })
    await advance()
    await seed
    onUpdate.mockClear()
    const slow = write({ q: 'slow' }, { limitUrlUpdates: throttle(1000) })
    const fast = write({ q: 'fast' }, { limitUrlUpdates: throttle(50) })
    await advance(999)
    expect(onUpdate).not.toHaveBeenCalled()
    await advance(1)
    await Promise.all([slow, fast])
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0]?.[0].searchParams.get('q')).toBe('fast')
    await advance(5000)
    const idle = write({ q: 'after idle' }, { limitUrlUpdates: throttle(1000) })
    await advance(0)
    await idle
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it('debounces each key independently even with push history', async () => {
    const { write, onUpdate } = mount({
      a: parseAsString.withOptions({ limitUrlUpdates: debounce(500), history: 'push' }),
      b: parseAsString.withOptions({ limitUrlUpdates: debounce(1500) }),
    })
    const first = write({ a: 'first', b: 'other' })
    const settled = vi.fn()
    void first.then(settled)
    await advance(200)
    const second = write({ a: 'latest' })
    await advance(499)
    expect(onUpdate).not.toHaveBeenCalled()
    // A debounce enters nuqs's throttle queue on a subsequent event-loop tick.
    await advance(2)
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0]?.[0].searchParams.get('a')).toBe('latest')
    expect(onUpdate.mock.calls[0]?.[0].searchParams.has('b')).toBe(false)
    expect(settled).not.toHaveBeenCalled()
    await advance(800)
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate.mock.calls[1]?.[0].searchParams.get('b')).toBe('other')
    await Promise.all([first, second])
  })

  it('wraps the URL commit in the supplied transition', async () => {
    const transition = vi.fn((action: () => void) => action())
    const { write, onUpdate } = mount({ q: parseAsString })
    const result = write({ q: 'hello' }, { startTransition: transition, shallow: false })
    expect(transition).not.toHaveBeenCalled()
    await advance()
    await result
    expect(transition).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
  })
})
