import { act, cleanup, render, screen } from '@testing-library/react'
import { useAtomValueRawSync, useStore } from 'jotai'
import { parseAsIsoDate, parseAsNativeArrayOf, parseAsString } from 'nuqs'
import { afterEach, expect, it } from 'vite-plus/test'
import { createQueryGroup } from './index'
import { QueryTestingAdapter } from './testing'

afterEach(cleanup)

it('notifies aliased readers of typed updates even when the encoded URL stays unchanged', async () => {
  const dateAtomGroup = createQueryGroup({ day: parseAsIsoDate })
  const dateAtom = dateAtomGroup.fields.day
  const aliasAtomGroup = createQueryGroup({ date: parseAsIsoDate }, { urlKeys: { date: 'day' } })
  const aliasAtom = aliasAtomGroup.atom

  let store!: ReturnType<typeof useStore>
  function Reader() {
    store = useStore()
    const { date } = useAtomValueRawSync(aliasAtom)
    return <p>{date?.toISOString()}</p>
  }
  const view = render(
    <QueryTestingAdapter
      groups={[dateAtomGroup, aliasAtomGroup]}
      searchParams="day=2026-09-09"
      hasMemory
    >
      <Reader />
    </QueryTestingAdapter>,
  )
  const date = new Date('2026-09-09T12:34:56.000Z')
  await act(async () => {
    await store.set(dateAtom, date)
  })
  expect(screen.getByText(date.toISOString())).toBeDefined()
  expect(store.get(aliasAtom).date).toBe(date)

  const later = new Date('2026-09-09T15:00:00.000Z')
  await act(async () => {
    await store.set(dateAtom, later)
  })
  expect(screen.getByText(later.toISOString())).toBeDefined()
  view.unmount()
  render(
    <QueryTestingAdapter
      groups={[dateAtomGroup, aliasAtomGroup]}
      searchParams="day=2026-09-09"
      hasMemory
    >
      <Reader />
    </QueryTestingAdapter>,
  )
  expect(screen.getByText('2026-09-09T00:00:00.000Z')).toBeDefined()
})

it('shares cleared values while retaining each reader default', async () => {
  const firstGroup = createQueryGroup({ q: parseAsString.withDefault('first') })
  const first = firstGroup.fields.q
  const secondGroup = createQueryGroup({ q: parseAsString.withDefault('second') })
  const second = secondGroup.fields.q
  let store!: ReturnType<typeof useStore>
  function Capture() {
    store = useStore()
    return null
  }
  render(
    <QueryTestingAdapter groups={[firstGroup, secondGroup]} hasMemory>
      <Capture />
    </QueryTestingAdapter>,
  )
  await act(async () => {
    await store.set(first, 'shared')
  })
  expect(store.get(second)).toBe('shared')
  await act(async () => {
    await store.set(second, null)
  })
  expect(store.get(first)).toBe('first')
  expect(store.get(second)).toBe('second')
})

it('inherits nuqs native-array normalization after the URL commits', async () => {
  const itemsGroup = createQueryGroup(
    { items: parseAsNativeArrayOf(parseAsString) },
    {
      clearOnDefault: false,
    },
  )
  const items = itemsGroup.fields.items
  let store!: ReturnType<typeof useStore>
  function Capture() {
    store = useStore()
    return null
  }
  const view = render(
    <QueryTestingAdapter groups={[itemsGroup]} hasMemory>
      <Capture />
    </QueryTestingAdapter>,
  )
  let commit!: Promise<URLSearchParams>
  act(() => {
    commit = store.set(items, [])
  })
  expect(store.get(items)).toEqual([])
  await act(async () => {
    await commit
  })
  expect(store.get(items)).toEqual([''])

  view.unmount()
  render(
    <QueryTestingAdapter groups={[itemsGroup]} searchParams="items=" hasMemory>
      <Capture />
    </QueryTestingAdapter>,
  )
  expect(store.get(items)).toEqual([''])
})
