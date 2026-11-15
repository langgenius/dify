import type { WorkflowTranslate } from '../parallel'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import formatToTracingNodeList from '../index'

const t = withSelectorKey((key: string) => key, 'workflow') as WorkflowTranslate

it('orders the real formatter output without mutating source traces', () => {
  const traces = [
    createNodeTracing({ node_id: 'b', index: 2 }),
    createNodeTracing({ node_id: 'a', index: 0 }),
    createNodeTracing({ node_id: 'c', index: 1 }),
  ]
  expect(formatToTracingNodeList(traces, t).map((node) => node.node_id)).toEqual(['a', 'c', 'b'])
  expect(traces.map((node) => node.node_id)).toEqual(['b', 'a', 'c'])
})

it.each([
  { type: BlockEnum.Loop, parentKey: 'loop_id', indexKey: 'loop_index' },
  { type: BlockEnum.Iteration, parentKey: 'iteration_id', indexKey: 'iteration_index' },
])(
  'nests $type runs and propagates failed child state through the full formatter',
  ({ type, parentKey, indexKey }) => {
    const parent = createNodeTracing({
      node_id: 'parent',
      node_type: type,
      index: 0,
      status: 'succeeded',
    })
    const child = createNodeTracing({
      node_id: 'child',
      index: 1,
      status: 'failed',
      error: 'Provider unavailable',
      execution_metadata: {
        total_tokens: 0,
        total_price: 0,
        currency: 'USD',
        [parentKey]: 'parent',
        [indexKey]: 0,
      },
    })
    const result = formatToTracingNodeList([child, parent], t)
    expect(result).toEqual([
      expect.objectContaining({
        node_id: 'parent',
        status: 'failed',
        error: 'Provider unavailable',
        details: [[expect.objectContaining({ node_id: 'child', status: 'failed' })]],
      }),
    ])
    expect(parent.status).toBe('succeeded')
    expect(parent.details).toBeUndefined()
  },
)
