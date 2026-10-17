import type { WorkflowRunOwner } from './log'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { fetchRunDetail, fetchTracingList } from './log'

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockRequest },
}))

const owners: Array<[WorkflowRunOwner, string[], Record<string, string>]> = [
  [{ kind: 'app', appId: 'app-1' }, ['apps', 'byAppId'], { app_id: 'app-1' }],
  [
    { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    ['rag', 'pipelines', 'byPipelineId'],
    { pipeline_id: 'pipeline-1' },
  ],
  [
    { kind: 'snippet', snippetId: 'snippet-1' },
    ['snippets', 'bySnippetId'],
    { snippet_id: 'snippet-1' },
  ],
]

describe('workflow run log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(owners)('loads the %o run detail with a canvas graph', async (owner, prefix, params) => {
    mockRequest.mockResolvedValue({
      id: 'run-1',
      graph: { nodes: [{ id: 'start', data: { type: BlockEnum.Start } }], edges: [] },
      inputs: { query: 'hi' },
      outputs: {},
    })

    const detail = await fetchRunDetail(owner, 'run-1')

    expect(mockRequest).toHaveBeenCalledWith(
      [...prefix, 'workflowRuns', 'byRunId', 'get'],
      { params: { ...params, run_id: 'run-1' } },
      expect.any(Object),
    )
    expect(detail.graph.nodes[0]).toMatchObject({ id: 'start', data: { title: '', desc: '' } })
  })

  it.each(owners)('loads the %o node executions as tracing', async (owner, prefix, params) => {
    mockRequest.mockResolvedValue({
      data: [
        { id: 'exec-1', node_type: BlockEnum.LLM, title: 'LLM' },
        { id: 'exec-2', node_type: 'future-block' },
      ],
    })

    const tracing = await fetchTracingList(owner, 'run-1')

    expect(mockRequest).toHaveBeenCalledWith(
      [...prefix, 'workflowRuns', 'byRunId', 'nodeExecutions', 'get'],
      { params: { ...params, run_id: 'run-1' } },
      expect.any(Object),
    )
    expect(tracing.map((node) => node.id)).toEqual(['exec-1'])
  })
})
