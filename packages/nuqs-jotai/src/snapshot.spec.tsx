import { act, cleanup, render, screen } from '@testing-library/react'
import { useAtomValue, useStore } from 'jotai'
import { parseAsIsoDate, parseAsNativeArrayOf, parseAsString } from 'nuqs'
import { afterEach, expect, it } from 'vite-plus/test'
import { atomWithSearchParam, atomWithSearchParams, QueryStateProvider } from './index'
import { createMemoryQueryAdapter } from './testing'

afterEach(cleanup)

it('notifies aliased readers of typed updates even when the encoded URL stays unchanged', async () => {
  const dateAtom = atomWithSearchParam('day', parseAsIsoDate)
  const aliasAtom = atomWithSearchParams({ date: parseAsIsoDate }, { urlKeys: { date: 'day' } })
  const adapter = createMemoryQueryAdapter('http://localhost/?day=2026-09-09')
  let store!: ReturnType<typeof useStore>
  function Reader() {
    store = useStore()
    const { date } = useAtomValue(aliasAtom)
    return <p>{date?.toISOString()}</p>
  }
  const view = render(
    <QueryStateProvider adapter={adapter}>
      <Reader />
    </QueryStateProvider>,
  )
  const date = new Date('2026-09-09T12:34:56.000Z')
  await act(async () => {
    await store.set(dateAtom, date)
  })
  expect(screen.getByText(date.toISOString())).toBeDefined()
  expect(store.get(aliasAtom).date).toBe(date)
  expect(adapter.read().search).toBe('?day=2026-09-09')
  const later = new Date('2026-09-09T15:00:00.000Z')
  await act(async () => {
    await store.set(dateAtom, later)
  })
  expect(screen.getByText(later.toISOString())).toBeDefined()
  view.unmount()
  render(
    <QueryStateProvider adapter={adapter}>
      <Reader />
    </QueryStateProvider>,
  )
  expect(screen.getByText('2026-09-09T00:00:00.000Z')).toBeDefined()
})

it('shares cleared values while retaining each reader default', async () => {
  const first = atomWithSearchParam('q', parseAsString.withDefault('first'))
  const second = atomWithSearchParam('q', parseAsString.withDefault('second'))
  let store!: ReturnType<typeof useStore>
  function Capture() {
    store = useStore()
    return null
  }
  const adapter = createMemoryQueryAdapter()
  render(
    <QueryStateProvider adapter={adapter}>
      <Capture />
    </QueryStateProvider>,
  )
  await store.set(first, 'shared')
  expect(store.get(second)).toBe('shared')
  await store.set(second, null)
  expect(store.get(first)).toBe('first')
  expect(store.get(second)).toBe('second')
  expect(adapter.read().searchParams.has('q')).toBe(false)
})

it('keeps an empty string array in memory without changing the native URL encoding', async () => {
  const items = atomWithSearchParam('items', parseAsNativeArrayOf(parseAsString), {
    clearOnDefault: false,
  })
  let store!: ReturnType<typeof useStore>
  function Capture() {
    store = useStore()
    return null
  }
  const adapter = createMemoryQueryAdapter()
  const view = render(
    <QueryStateProvider adapter={adapter}>
      <Capture />
    </QueryStateProvider>,
  )
  await store.set(items, [])
  expect(store.get(items)).toEqual([])
  expect(adapter.read().searchParams.getAll('items')).toEqual([''])
  view.unmount()
  render(
    <QueryStateProvider adapter={adapter}>
      <Capture />
    </QueryStateProvider>,
  )
  expect(store.get(items)).toEqual([''])
})
