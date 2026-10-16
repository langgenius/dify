import type { AnnotationCountResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { UseQueryResult } from '@tanstack/react-query'
import type { QueryParam } from '../filter'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Filter from '../filter'

const mockUseQuery = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: unknown) => mockUseQuery(options),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        annotations: {
          count: {
            get: {
              queryOptions: (options: unknown) => options,
            },
          },
        },
      },
    },
  },
}))

// ============================================================================
// Test Utilities
// ============================================================================

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

// ============================================================================
// Mock Return Value Factory
// ============================================================================

type MockQueryResult<T> = Pick<UseQueryResult<T>, 'data' | 'isLoading' | 'error' | 'refetch'>

const createMockQueryResult = <T,>(
  overrides: Partial<MockQueryResult<T>> = {},
): MockQueryResult<T> => ({
  data: undefined,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
  ...overrides,
})

// ============================================================================
// Tests
// ============================================================================

describe('Filter', () => {
  const appId = 'app-1'
  const childContent = 'child-content'
  const defaultQueryParams: QueryParam = { keyword: '' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render nothing when data is loading', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({ isLoading: true }),
      )

      // Act
      const { container } = renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when data is undefined', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({ data: undefined, isLoading: false }),
      )

      // Act
      const { container } = renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render filter and children when data is available', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({
          data: { count: 20 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toBeInTheDocument()
      expect(screen.getByText(childContent)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should query the annotations count for appId', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({
          data: { count: 10 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(mockUseQuery).toHaveBeenCalledWith({ input: { params: { app_id: appId } } })
    })

    it('should display keyword value in input', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({
          data: { count: 10 },
          isLoading: false,
        }),
      )
      const queryParams: QueryParam = { keyword: 'test-keyword' }

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={queryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveValue(
        'test-keyword',
      )
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call setQueryParams when typing in search input', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({
          data: { count: 20 },
          isLoading: false,
        }),
      )
      const queryParams: QueryParam = { keyword: '' }
      const setQueryParams = vi.fn()

      renderWithQueryClient(
        <Filter appId={appId} queryParams={queryParams} setQueryParams={setQueryParams}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Act
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
      fireEvent.change(input, { target: { value: 'updated' } })

      // Assert
      expect(setQueryParams).toHaveBeenCalledWith({ ...queryParams, keyword: 'updated' })
    })

    it('should call setQueryParams with empty keyword when clearing input', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({
          data: { count: 20 },
          isLoading: false,
        }),
      )
      const queryParams: QueryParam = { keyword: 'prefill' }
      const setQueryParams = vi.fn()

      renderWithQueryClient(
        <Filter appId={appId} queryParams={queryParams} setQueryParams={setQueryParams}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))

      // Assert
      expect(setQueryParams).toHaveBeenCalledWith({ ...queryParams, keyword: '' })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty keyword in queryParams', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({
          data: { count: 5 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={{ keyword: '' }} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveValue('')
    })

    it('should handle undefined keyword in queryParams', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({
          data: { count: 5 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={{ keyword: undefined }} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toBeInTheDocument()
    })

    it('should handle zero count', () => {
      // Arrange
      mockUseQuery.mockReturnValue(
        createMockQueryResult<AnnotationCountResponse>({
          data: { count: 0 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert - should still render when count is 0
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toBeInTheDocument()
    })
  })
})
