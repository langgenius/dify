import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useInputVariables } from '../hooks'

const mockUseDatasetDetailContextWithSelector = vi.fn()
const mockUsePublishedPipelineProcessingParams = vi.fn()

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (value: unknown) => unknown) =>
    mockUseDatasetDetailContextWithSelector(selector),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'rag.pipelines.byPipelineId.workflows.published.processing.parameters.get': (o: {
      input: { params: { pipeline_id: string }; query: { node_id: string } }
      enabled?: boolean
    }) =>
      mockUsePublishedPipelineProcessingParams({
        pipeline_id: o.input.params.pipeline_id,
        node_id: o.input.query.node_id,
      }),
  })
})

describe('useInputVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDatasetDetailContextWithSelector.mockReturnValue('pipeline-123')
    mockUsePublishedPipelineProcessingParams.mockReturnValue({
      data: { inputs: [{ name: 'query', type: 'string' }] },
      isFetching: false,
    })
  })

  it('should return paramsConfig and isFetchingParams', () => {
    const { result } = renderHook(() => useInputVariables('node-1'))

    expect(result.current.paramsConfig).toEqual({ inputs: [{ name: 'query', type: 'string' }] })
    expect(result.current.isFetchingParams).toBe(false)
  })

  it('should call usePublishedPipelineProcessingParams with pipeline_id and node_id', () => {
    renderHook(() => useInputVariables('node-1'))

    expect(mockUsePublishedPipelineProcessingParams).toHaveBeenCalledWith({
      pipeline_id: 'pipeline-123',
      node_id: 'node-1',
    })
  })

  it('should return isFetchingParams true when loading', () => {
    mockUsePublishedPipelineProcessingParams.mockReturnValue({
      data: undefined,
      isFetching: true,
    })

    const { result } = renderHook(() => useInputVariables('node-1'))
    expect(result.current.isFetchingParams).toBe(true)
    expect(result.current.paramsConfig).toBeUndefined()
  })
})
