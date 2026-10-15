import { renderHook } from '@testing-library/react'
import { useInputVariables } from '../hooks'

const mockUseDraftPipelineProcessingParams = vi.hoisted(() =>
  vi.fn(
    (): {
      data?: { variables: { variable: string }[] }
      isFetching: boolean
      isError?: boolean
    } => ({
      data: { variables: [{ variable: 'chunkSize' }] },
      isFetching: true,
      isError: false,
    }),
  ),
)

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { pipelineId: string }) => string) =>
    selector({ pipelineId: 'pipeline-1' }),
}))

vi.mock('@/service/use-pipeline', () => ({
  useDraftPipelineProcessingParams: mockUseDraftPipelineProcessingParams,
}))

describe('useInputVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query processing params with the current pipeline id and datasource node id', () => {
    const { result } = renderHook(() => useInputVariables('datasource-node'))

    expect(mockUseDraftPipelineProcessingParams).toHaveBeenCalledWith(
      {
        pipeline_id: 'pipeline-1',
        node_id: 'datasource-node',
      },
      true,
      { meta: { errorMessage: 'common.api.loadFailed' } },
    )
    expect(result.current.isFetchingParams).toBe(true)
    expect(result.current.isParamsError).toBe(false)
    expect(result.current.paramsConfig).toEqual({ variables: [{ variable: 'chunkSize' }] })
  })

  it('should block running only when the params failed to load', () => {
    mockUseDraftPipelineProcessingParams.mockReturnValueOnce({
      data: undefined,
      isFetching: false,
      isError: true,
    })
    const { result } = renderHook(() => useInputVariables('datasource-node'))

    expect(result.current.isParamsError).toBe(true)
  })
})
