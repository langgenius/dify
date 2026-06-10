import { renderHook } from '@testing-library/react'
import { useInputVariables } from '../hooks'

const mockUseDraftPipelineProcessingParams = vi.hoisted(() => vi.fn(() => ({
  data: { variables: [{ variable: 'chunkSize' }] },
  isFetching: true,
})))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { pipelineId: string }) => string) => selector({ pipelineId: 'pipeline-1' }),
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

    expect(mockUseDraftPipelineProcessingParams).toHaveBeenCalledWith({
      pipeline_id: 'pipeline-1',
      node_id: 'datasource-node',
    })
    expect(result.current.isFetchingParams).toBe(true)
    expect(result.current.paramsConfig).toEqual({ variables: [{ variable: 'chunkSize' }] })
  })
})
