import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { MessageContentPart, OpenUIContentDelta } from '../protocol/types'
import {
  appendTextPart,
  hasOpenUIParts,
  interruptContentParts,
  replaceSavedBlockInParts,
  updateContentPart,
} from '../stream-reducer'

const block: OpenUIContentBlock = {
  id: 'ui-1',
  type: 'openui',
  library_version: 'dify-ui-v1',
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
    const updated = updateContentPart([block], delta)

    expect(updated).toEqual([
      { ...block, source: block.source + delta.source_delta, sequence: delta.sequence },
    ])
    expect(updateContentPart(updated, delta)).toEqual(updated)
    expect(updateContentPart(updated, block)).toEqual(updated)
  })

  it('waits for an authoritative snapshot when the delta base is missing', () => {
    expect(updateContentPart(undefined, delta)).toEqual([])
    const afterGap = updateContentPart([block], { ...delta, base_sequence: 2 })
    expect(afterGap).toEqual([block])

    const completed: OpenUIContentBlock = {
      ...block,
      source: block.source + delta.source_delta,
      sequence: 4,
      status: 'completed',
    }
    expect(updateContentPart(afterGap, completed)).toEqual([completed])
  })

  it('replaces accumulated deltas with an authoritative source replacement', () => {
    const updated = updateContentPart([block], delta)
    const replacement: OpenUIContentBlock = {
      ...block,
      source: 'root = Stack([Text("Corrected revenue")])',
      sequence: 4,
    }

    expect(updateContentPart(updated, replacement)).toEqual([replacement])
  })

  it.each(['completed', 'cancelled', 'error'] as const)(
    'does not append delayed deltas to a %s block',
    (status) => {
      const terminal: OpenUIContentBlock = { ...block, status }
      expect(updateContentPart([terminal], delta)).toEqual([terminal])
    },
  )

  it('replaces a block with its newer snapshot and ignores replayed events', () => {
    const initial = updateContentPart(undefined, block)
    const completed: OpenUIContentBlock = {
      ...block,
      source: `${block.source}\ntitle = Heading("Revenue")`,
      sequence: 3,
      status: 'completed',
    }
    const latest = updateContentPart(initial, completed)
    const replayed = updateContentPart(latest, { ...block, sequence: 2 })

    expect(replayed).toEqual([completed])
    expect(updateContentPart(replayed, completed)).toEqual([completed])
  })

  it('preserves text and other UI parts in arrival order when one block changes', () => {
    const intro = appendTextPart(undefined, 'Intro ')
    const mergedIntro = appendTextPart(intro, 'text')
    expect(mergedIntro).toEqual([{ id: 'text:0', type: 'text', text: 'Intro text' }])

    const withFirst = updateContentPart(mergedIntro, block)
    const withMiddle = appendTextPart(withFirst, 'Middle')
    const second: OpenUIContentBlock = { ...block, id: 'ui-2' }
    const parts = updateContentPart(withMiddle, second)
    const updated: OpenUIContentBlock = { ...block, sequence: 2, status: 'completed' }

    expect(updateContentPart(parts, updated)).toEqual([
      { id: 'text:0', type: 'text', text: 'Intro text' },
      updated,
      { id: 'text:2', type: 'text', text: 'Middle' },
      second,
    ])
  })

  it('only marks unfinished UI parts as interrupted and preserves text parts', () => {
    const completed: OpenUIContentBlock = { ...block, id: 'completed', status: 'completed' }
    const parts: MessageContentPart[] = [
      { id: 'text:0', type: 'text', text: 'Before' },
      completed,
      block,
    ]
    expect(interruptContentParts(parts, 'cancelled')).toEqual([
      { id: 'text:0', type: 'text', text: 'Before' },
      completed,
      { ...block, status: 'cancelled' },
    ])
  })

  it('replaces a saved block and detects whether OpenUI parts exist', () => {
    const saved: OpenUIContentBlock = {
      ...block,
      status: 'completed',
      form_state: { filters: { region: { value: 'East' } } },
    }
    const parts: MessageContentPart[] = [{ id: 'text:0', type: 'text', text: 'Intro' }, block]
    expect(replaceSavedBlockInParts(parts, saved)).toEqual([
      { id: 'text:0', type: 'text', text: 'Intro' },
      saved,
    ])
    expect(hasOpenUIParts(parts)).toBe(true)
    expect(hasOpenUIParts([{ id: 'text:0', type: 'text', text: 'Only text' }])).toBe(false)
    expect(hasOpenUIParts(undefined)).toBe(false)
  })
})
