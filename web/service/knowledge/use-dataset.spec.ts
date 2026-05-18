import { useQuery } from '@tanstack/react-query'
import { get } from '../base'
import { useDatasetDetail, useDatasetRelatedApps } from './use-dataset'

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}))

vi.mock('../base', () => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('../use-base', () => ({
  useInvalid: vi.fn(),
}))

const mockUseQuery = vi.mocked(useQuery)
const mockGet = vi.mocked(get)

type QueryOptions = Parameters<typeof useQuery>[0]
type RetryFn = (failureCount: number, error: unknown) => boolean

const getLastQueryOptions = () => {
  return mockUseQuery.mock.calls.at(-1)?.[0] as QueryOptions
}

const getRetryFn = () => {
  return getLastQueryOptions().retry as RetryFn
}

describe('knowledge dataset hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({} as ReturnType<typeof useQuery>)
  })

  describe('useDatasetDetail', () => {
    it('should not retry forbidden or missing dataset detail errors', () => {
      // Arrange & Act
      useDatasetDetail('dataset-1')
      const retry = getRetryFn()

      // Assert
      expect(retry(0, new Response(null, { status: 403 }))).toBe(false)
      expect(retry(0, new Response(null, { status: 404 }))).toBe(false)
    })

    it('should retry other dataset detail errors fewer than three times', () => {
      // Arrange & Act
      useDatasetDetail('dataset-1')
      const retry = getRetryFn()

      // Assert
      expect(retry(2, new Error('temporary failure'))).toBe(true)
      expect(retry(3, new Error('temporary failure'))).toBe(false)
    })

    it('should fetch dataset detail without silent mode', () => {
      // Arrange
      mockGet.mockResolvedValue({ id: 'dataset-1' })

      // Act
      useDatasetDetail('dataset-1')
      const queryFn = getLastQueryOptions().queryFn as () => unknown
      queryFn()

      // Assert
      expect(mockGet).toHaveBeenCalledWith('/datasets/dataset-1')
    })
  })

  describe('useDatasetRelatedApps', () => {
    it('should use explicit enabled option when provided', () => {
      // Arrange & Act
      useDatasetRelatedApps('dataset-1', { enabled: false })

      // Assert
      expect(getLastQueryOptions().enabled).toBe(false)
    })

    it('should enable related apps query when dataset id exists and no option is provided', () => {
      // Arrange & Act
      useDatasetRelatedApps('dataset-1')

      // Assert
      expect(getLastQueryOptions().enabled).toBe(true)
    })
  })
})
