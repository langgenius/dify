import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { OpenUIContentDelta } from '../protocol/types'
import { interruptContentBlocks, updateContentBlock } from '../stream-reducer'

const block: OpenUIContentBlock = {
  id: 'ui-1',
  type: 'openui',
  library_version: 'dify-ui-v1',
  text_offset: 0,
  sequence: 1,
  source: 'root = Stack([title])',
  status: 'streaming',
  form_state: {},
}

describe('OpenUI content streaming', () => {
  const delta: OpenUIContentDelta = {
    type: 'openui_delta',
    id: block.id,
    base_sequence: 1,
    sequence: 3,
    source_delta: '\ntitle = Heading("Revenue")',
  }

  it('appends a delta once, including coalesced sequence jumps', () => {
    const updated = updateContentBlock([block], delta)

    expect(updated).toEqual([
      { ...block, source: block.source + delta.source_delta, sequence: delta.sequence },
    ])
    expect(updateContentBlock(updated, delta)).toEqual(updated)
    expect(updateContentBlock(updated, block)).toEqual(updated)
  })

  it('waits for an authoritative snapshot when the delta base is missing', () => {
    expect(updateContentBlock(undefined, delta)).toEqual([])
    const afterGap = updateContentBlock([block], { ...delta, base_sequence: 2 })
    expect(afterGap).toEqual([block])

    const completed: OpenUIContentBlock = {
      ...block,
      source: block.source + delta.source_delta,
      sequence: 4,
      status: 'completed',
    }
    expect(updateContentBlock(afterGap, completed)).toEqual([completed])
  })

  it('replaces accumulated deltas with an authoritative source replacement', () => {
    const updated = updateContentBlock([block], delta)
    const replacement: OpenUIContentBlock = {
      ...block,
      source: 'root = Stack([Text("Corrected revenue")])',
      sequence: 4,
    }

    expect(updateContentBlock(updated, replacement)).toEqual([replacement])
  })

  it.each(['completed', 'cancelled', 'error'] as const)(
    'does not append delayed deltas to a %s block',
    (status) => {
      const terminal: OpenUIContentBlock = { ...block, status }
      expect(updateContentBlock([terminal], delta)).toEqual([terminal])
    },
  )

  it('replaces a block with its newer snapshot and ignores replayed events', () => {
    const initial = updateContentBlock(undefined, block)
    const completed: OpenUIContentBlock = {
      ...block,
      source: `${block.source}\ntitle = Heading("Revenue")`,
      sequence: 3,
      status: 'completed',
    }
    const latest = updateContentBlock(initial, completed)
    const replayed = updateContentBlock(latest, { ...block, sequence: 2 })

    expect(replayed).toEqual([completed])
    expect(updateContentBlock(replayed, completed)).toEqual([completed])
  })

  it('preserves other content blocks when one block changes', () => {
    const second: OpenUIContentBlock = { ...block, id: 'ui-2' }
    const blocks = updateContentBlock([block], second)
    const updated: OpenUIContentBlock = { ...block, sequence: 2, status: 'completed' }

    expect(updateContentBlock(blocks, updated)).toEqual([updated, second])
  })

  it('only marks unfinished content as interrupted', () => {
    const completed: OpenUIContentBlock = { ...block, id: 'completed', status: 'completed' }
    expect(interruptContentBlocks([completed, block], 'cancelled')).toEqual([
      completed,
      { ...block, status: 'cancelled' },
    ])
  })
})
