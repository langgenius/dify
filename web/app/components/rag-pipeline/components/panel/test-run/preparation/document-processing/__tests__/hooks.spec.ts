import { renderHook } from '@testing-library/react'
import { useInputVariables } from '../hooks'

const mockUseDraftPipelineProcessingParams = vi.hoisted(() =>
  vi.fn((_params?: unknown, _enabled?: boolean) => ({
    data: { variables: [{ variable: 'chunkSize' }] },
    isFetching: true,
  })),
)

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { pipelineId: string }) => string) =>
    selector({ pipelineId: 'pipeline-1' }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get': (o: {
      input: { params: { pipeline_id: string }; query: { node_id: string } }
      enabled?: boolean
    }) =>
      mockUseDraftPipelineProcessingParams({
        pipeline_id: o.input.params.pipeline_id,
        node_id: o.input.query.node_id,
      }),
  })
})

describe('useInputVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query processing params with the current pipeline id and datasource node id', () => {
    const { result } = renderHook(() => useInputVariables('datasource-node'))

    expect(mockUseDraftPipelineProcessingParams).toHaveBeenCalledWith({
      pipeline_id: 'pipeline-1',
      node_id: 'datasource-node',
    })
    expect(result.current.isFetchingParams).toBe(true)
    expect(result.current.paramsConfig).toEqual({ variables: [{ variable: 'chunkSize' }] })
  })
})
