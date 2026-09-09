import type { ExtractAtomValue } from 'jotai'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom, createStore, Provider, useSetAtom, useStore } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, expectTypeOf, it, vi } from 'vite-plus/test'
import {
  atomsWithSearchParams,
  atomWithSearchParam,
  atomWithSearchParams,
  useQueryAtom,
  useQueryAtomValue,
} from './index'
import { QueryTestingAdapter } from './testing'

afterEach(cleanup)

it('reads URL state and commits using the surrounding nuqs adapter', async () => {
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  const onUrlUpdate = vi.fn()
  let commit!: Promise<URLSearchParams>
  function Counter() {
    const [value, set] = useQueryAtom(page)
    return (
      <button
        onClick={() => {
          commit = set((value) => value + 1)
        }}
      >
        {value}
      </button>
    )
  }
  render(
    <QueryTestingAdapter atoms={[page]} searchParams="page=2" hasMemory onUrlUpdate={onUrlUpdate}>
      <Counter />
    </QueryTestingAdapter>,
  )
  expect(screen.getByRole('button').textContent).toBe('2')
  await act(async () => {
    fireEvent.click(screen.getByRole('button'))
    await commit
  })
  expect(screen.getByRole('button').textContent).toBe('3')
  expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.get('page')).toBe('3')
})

it('preserves parent application state and derived atom interoperability across feature scopes', async () => {
  const workspace = atom('first')
  const local = atom(false)
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  const label = atom((get) => `${get(workspace)}:${get(page)}`)
  const parent = createStore()
  function Reader() {
    return <p>{useQueryAtomValue(label)}</p>
  }
  render(
    <Provider store={parent}>
      <QueryTestingAdapter atoms={[page]} searchParams="page=2">
        <ScopeProvider atoms={[local]}>
          <Reader />
        </ScopeProvider>
      </QueryTestingAdapter>
    </Provider>,
  )
  expect(screen.getByText('first:2')).toBeDefined()
  act(() => parent.set(workspace, 'second'))
  expect(screen.getByText('second:2')).toBeDefined()
})

it('retains unregistered parent atoms while isolating registered snapshots', () => {
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  function Reader() {
    return <p>{useQueryAtomValue(page)}</p>
  }
  render(
    <Provider>
      <QueryTestingAdapter atoms={[page]} searchParams="page=2">
        <Reader />
      </QueryTestingAdapter>
      <QueryTestingAdapter atoms={[page]} searchParams="page=7">
        <Reader />
      </QueryTestingAdapter>
    </Provider>,
  )
  expect(screen.getByText('2')).toBeDefined()
  expect(screen.getByText('7')).toBeDefined()
})

it('supports alias groups, partial updates, resets, and factory options', async () => {
  const group = atomWithSearchParams(
    { page: parseAsInteger.withDefault(1), q: parseAsString },
    { urlKeys: { q: 'search' }, history: 'push' },
  )
  let store!: ReturnType<typeof useStore>
  function Capture() {
    store = useStore()
    return <p>{JSON.stringify(useQueryAtomValue(group))}</p>
  }
  const onUrlUpdate = vi.fn()
  render(
    <QueryTestingAdapter atoms={[group]} hasMemory onUrlUpdate={onUrlUpdate}>
      <Capture />
    </QueryTestingAdapter>,
  )
  await act(async () => {
    await store.set(group, { q: 'hello', page: 3 })
  })
  expect(store.get(group)).toEqual({ page: 3, q: 'hello' })
  expect(onUrlUpdate.mock.calls[0]?.[0].queryString).toContain('search=hello')
  expect(onUrlUpdate.mock.calls[0]?.[0].options.history).toBe('push')
  await act(async () => {
    await store.set(group, null)
  })
  expect(store.get(group)).toEqual({ page: 1, q: null })
})

it('registers a field group once and keeps unrelated field subscribers quiet', async () => {
  const fields = atomsWithSearchParams({ page: parseAsInteger.withDefault(1), q: parseAsString })
  let store!: ReturnType<typeof useStore>
  const observed = vi.fn()
  function Capture() {
    store = useStore()
    return null
  }
  render(
    <QueryTestingAdapter atoms={[fields.page, fields.q]} hasMemory>
      <Capture />
    </QueryTestingAdapter>,
  )
  const unsubscribe = store.sub(fields.q, observed)
  await act(async () => {
    await store.set(fields.page, (value) => value + 1)
  })
  expect(store.get(fields.page)).toBe(2)
  expect(observed).not.toHaveBeenCalled()
  unsubscribe()
})

it('updates native nuqs readers immediately from atom commands', async () => {
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  let write!: ReturnType<typeof useSetAtom<typeof page>>
  function Capture() {
    write = useSetAtom(page)
    const [value] = useQueryState('page', parseAsInteger)
    return <p>{value}</p>
  }
  render(
    <QueryTestingAdapter atoms={[page]} searchParams="page=1" hasMemory>
      <Capture />
    </QueryTestingAdapter>,
  )
  let commit!: Promise<URLSearchParams>
  act(() => {
    commit = write(2)
  })
  expect(screen.getByText('2')).toBeDefined()
  await act(async () => {
    await commit
  })
})

it('uses nuqs provider processing and current default options', async () => {
  const page = atomWithSearchParam('page', parseAsInteger)
  let store!: ReturnType<typeof useStore>
  function Capture() {
    store = useStore()
    return null
  }
  const onUrlUpdate = vi.fn()
  function App({ history }: { history: 'push' | 'replace' }) {
    return (
      <QueryTestingAdapter
        atoms={[page]}
        hasMemory
        defaultOptions={{ history }}
        onUrlUpdate={onUrlUpdate}
        processUrlSearchParams={(search) => {
          search.set('processed', 'yes')
          return search
        }}
      >
        <Capture />
      </QueryTestingAdapter>
    )
  }
  const view = render(<App history="replace" />)
  await act(async () => {
    await store.set(page, 1)
  })
  view.rerender(<App history="push" />)
  await act(async () => {
    await store.set(page, 2)
  })
  expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.history).toBe('push')
  expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('processed')).toBe('yes')
})

it('renders the adapter server snapshot without a browser runtime', () => {
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  function Reader() {
    return <p>{useQueryAtomValue(page)}</p>
  }
  const html = renderToString(
    <QueryTestingAdapter atoms={[page]} searchParams="page=8">
      <Reader />
    </QueryTestingAdapter>,
  )
  expect(html).toContain('8')
})

it('requires explicit registration instead of silently reading a default', () => {
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  const store = createStore()
  expect(() => store.get(page)).toThrow('Register this atom')
  expect(() => store.set(page, 2)).toThrow('Register this atom')
})

it('rejects saved writers after their bridge unmounts', () => {
  const page = atomWithSearchParam('page', parseAsInteger)
  let store!: ReturnType<typeof useStore>
  function Capture() {
    store = useStore()
    return null
  }
  const view = render(
    <QueryTestingAdapter atoms={[page]}>
      <Capture />
    </QueryTestingAdapter>,
  )
  view.unmount()
  expect(() => store.set(page, 2)).toThrow('unmounts')
})

it('provides a non-null typed value when the parser has a default', () => {
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  const nullable = atomWithSearchParam('page', parseAsInteger)
  expectTypeOf<ExtractAtomValue<typeof page>>().toEqualTypeOf<number>()
  expectTypeOf<ExtractAtomValue<typeof nullable>>().toEqualTypeOf<number | null>()
})
