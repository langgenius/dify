import type { TFunction } from 'i18next'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { withSelectorKey } from '@/test/i18n-mock'
import formatParallel from '../index'

const t = withSelectorKey((key: string, options?: Record<string, string>) => {
  if (key === 'common.parallel') return 'Parallel'
  if (key === 'common.branch') return 'Branch'
  return options?.ns ? `${options.ns}.${key}` : key
}, 'workflow') as TFunction<['workflow']>

describe('formatParallel', () => {
  it('groups parallel nodes into a titled tree and preserves branch titles', () => {
    const result = formatParallel(
      [
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
      ],
      t,
    )

    expect(result.map((node) => node.node_id)).toEqual(['parallel-start', 'branch-a'])
    expect(result[0]?.parallelDetail).toMatchObject({
      parallelTitle: 'Parallel-1A',
      children: [{ node_id: 'parallel-start', parallelDetail: { branchTitle: 'Branch-1A-A' } }],
    })
    expect(result[1]?.parallelDetail).toMatchObject({
      parallelTitle: 'Parallel-1B',
      children: [
        { node_id: 'branch-a', title: 'Branch A', parallelDetail: { branchTitle: 'Branch-1B-A' } },
        { node_id: 'branch-child', title: 'Branch Child' },
      ],
    })
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
