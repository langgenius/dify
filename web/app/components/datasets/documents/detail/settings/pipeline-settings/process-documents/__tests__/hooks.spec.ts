import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInputVariables } from '../hooks'

let mockPipelineId: string | undefined

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { pipeline_id?: string } | null }) => unknown) =>
    selector({ dataset: mockPipelineId ? { pipeline_id: mockPipelineId } : null }),
}))

let mockParamsReturn: {
  data: Record<string, unknown> | undefined
  isFetching: boolean
}

const mockUsePublishedPipelineProcessingParams = vi.fn(
  (_params: { pipeline_id: string, node_id: string }) => mockParamsReturn,
)

vi.mock('@/service/use-pipeline', () => ({
  usePublishedPipelineProcessingParams: (params: { pipeline_id: string, node_id: string }) =>
    mockUsePublishedPipelineProcessingParams(params),
}))

describe('useInputVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId = 'pipeline-123'
    mockParamsReturn = {
      data: undefined,
      isFetching: false,
    }
  })

  // Returns paramsConfig from API
  describe('Data Retrieval', () => {
    it('should return paramsConfig from API', () => {
      const mockConfig = { variables: [{ name: 'var1', type: 'string' }] }
      mockParamsReturn = { data: mockConfig, isFetching: false }

      const { result } = renderHook(() => useInputVariables('node-456'))

      expect(result.current.paramsConfig).toEqual(mockConfig)
    })

    it('should return isFetchingParams loading state', () => {
      mockParamsReturn = { data: undefined, isFetching: true }

      const { result } = renderHook(() => useInputVariables('node-456'))

      expect(result.current.isFetchingParams).toBe(true)
    })
  })

  // Passes correct parameters to API hook
  describe('Parameter Passing', () => {
    it('should pass correct pipeline_id and node_id to API hook', () => {
      mockPipelineId = 'pipeline-789'
      mockParamsReturn = { data: undefined, isFetching: false }

      renderHook(() => useInputVariables('node-abc'))

      expect(mockUsePublishedPipelineProcessingParams).toHaveBeenCalledWith({
        pipeline_id: 'pipeline-789',
        node_id: 'node-abc',
      })
    })
  })
})
