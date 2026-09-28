import { act, cleanup, render } from '@testing-library/react'
import { atom, useAtomValueRawSync, useStore } from 'jotai'
import { parseAsInteger, useQueryStates } from 'nuqs'
import { useLayoutEffect } from 'react'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createQueryGroup } from './index'
import { QueryTestingAdapter } from './testing'

afterEach(cleanup)

it.each(['atoms', 'nuqs'] as const)(
  'uses current adapter defaults and processing for update-time layout writes (%s)',
  async (implementation) => {
    const pageGroup = createQueryGroup({ page: parseAsInteger })
    const page = pageGroup.fields.page
    const onUrlUpdate = vi.fn()
    let command: Promise<URLSearchParams> | undefined
    function Writer({ updated }: { updated: boolean }) {
      const store = useStore()
      const [, nativeWrite] = useQueryStates({ page: parseAsInteger })
      useLayoutEffect(() => {
        if (updated) {
          command = implementation === 'atoms' ? store.set(page, 2) : nativeWrite({ page: 2 })
        }
      }, [updated, store, nativeWrite])
      return null
    }
    function App({ updated }: { updated: boolean }) {
      return (
        <QueryTestingAdapter
          groups={[pageGroup]}
          hasMemory
          defaultOptions={{ history: updated ? 'push' : 'replace' }}
          processUrlSearchParams={(search) => {
            search.set('revision', updated ? 'current' : 'previous')
            return search
          }}
          onUrlUpdate={onUrlUpdate}
        >
          <Writer updated={updated} />
        </QueryTestingAdapter>
      )
    }
    const view = render(<App updated={false} />)
    view.rerender(<App updated />)
    await act(async () => {
      await command
    })
    expect(onUrlUpdate).toHaveBeenCalledOnce()
    const update = onUrlUpdate.mock.calls[0]![0]
    expect(update.options.history).toBe('push')
    expect(update.searchParams.get('revision')).toBe('current')
  },
)

it('publishes related fields as one complete snapshot to derived subscribers', async () => {
  const fieldsGroup = createQueryGroup({
    a: parseAsInteger.withDefault(0),
    b: parseAsInteger.withDefault(0),
  })
  const fields = fieldsGroup.fields
  const pair = atom((get) => [get(fields.a), get(fields.b)])
  let store!: ReturnType<typeof useStore>
  let write!: ReturnType<
    typeof useQueryStates<{ a: typeof parseAsInteger; b: typeof parseAsInteger }>
  >[1]
  function Capture() {
    store = useStore()
    const [, nativeWrite] = useQueryStates({ a: parseAsInteger, b: parseAsInteger })
    write = nativeWrite
    useAtomValueRawSync(pair)
    return null
  }
  render(
    <QueryTestingAdapter groups={[fieldsGroup]} hasMemory>
      <Capture />
    </QueryTestingAdapter>,
  )
  const seen: number[][] = []
  const unsubscribe = store.sub(pair, () => seen.push(store.get(pair)))
  try {
    await act(async () => {
      await write({ a: 1, b: 1 })
    })
    expect(seen).toEqual([[1, 1]])
    await act(async () => {
      await store.set(fieldsGroup.atom, { a: 2, b: 2 })
    })
    expect(seen).toEqual([
      [1, 1],
      [2, 2],
    ])
  } finally {
    unsubscribe()
  }
})
