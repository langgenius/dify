import type { NodeTracing } from '@/types/workflow'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import formatParallel from '../index'

const t = (key: string, options?: Record<string, string>) => {
  if (key === 'common.parallel')
    return 'Parallel'
  if (key === 'common.branch')
    return 'Branch'
  return options?.ns ? `${options.ns}.${key}` : key
}

const createNodeTracing = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: BlockEnum.Code,
  title: 'Node 1',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs_truncated: false,
  status: NodeRunningStatus.Succeeded,
  elapsed_time: 0,
  execution_metadata: {
    total_tokens: 0,
    total_price: 0,
    currency: 'USD',
  },
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  finished_at: 0,
  ...overrides,
})

describe('formatParallel', () => {
  it('groups parallel nodes into a titled tree and preserves branch titles', () => {
    const result = formatParallel([
      createNodeTracing({
        id: 'parallel-start',
        node_id: 'parallel-start',
        title: 'Parallel Start',
        parallel_id: 'parallel-1',
        parallel_start_node_id: 'parallel-start',
        parallelDetail: {
          isParallelStartNode: true,
          children: [],
        },
      }),
      createNodeTracing({
        id: 'branch-a',
        node_id: 'branch-a',
        title: 'Branch A',
        parallel_id: 'parallel-1',
        parallel_start_node_id: 'branch-a',
      }),
      createNodeTracing({
        id: 'branch-child',
        node_id: 'branch-child',
        title: 'Branch Child',
        parallel_id: 'parallel-1',
        parallel_start_node_id: 'branch-a',
      }),
    ], t)

    expect(result.length).toBeGreaterThan(0)
    expect(result.some(node => !!node.parallelDetail)).toBe(true)
    expect(result.some(node => node.parallelDetail?.children?.length)).toBe(true)
  })

  it('ignores nodes outside parallel groups', () => {
    const standalone = createNodeTracing({
      node_id: 'standalone',
      title: 'Standalone',
      parallel_id: undefined,
    })

    expect(formatParallel([standalone], t)).toEqual([standalone])
  })
})
