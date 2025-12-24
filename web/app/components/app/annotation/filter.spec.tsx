import type { UseQueryResult } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import type { QueryParam } from './filter'
import type { AnnotationsCountResponse } from '@/models/log'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import * as useLogModule from '@/service/use-log'
import Filter from './filter'

vi.mock('@/service/use-log')

const mockUseAnnotationsCount = useLogModule.useAnnotationsCount as Mock

// ============================================================================
// Test Utilities
// ============================================================================

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
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
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({ isLoading: true }),
      )

      // Act
      const { container } = renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={defaultQueryParams}
          setQueryParams={vi.fn()}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when data is undefined', () => {
      // Arrange
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({ data: undefined, isLoading: false }),
      )

      // Act
      const { container } = renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={defaultQueryParams}
          setQueryParams={vi.fn()}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render filter and children when data is available', () => {
      // Arrange
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({
          data: { count: 20 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={defaultQueryParams}
          setQueryParams={vi.fn()}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
      expect(screen.getByText(childContent)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should call useAnnotationsCount with appId', () => {
      // Arrange
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({
          data: { count: 10 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={defaultQueryParams}
          setQueryParams={vi.fn()}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(mockUseAnnotationsCount).toHaveBeenCalledWith(appId)
    })

    it('should display keyword value in input', () => {
      // Arrange
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({
          data: { count: 10 },
          isLoading: false,
        }),
      )
      const queryParams: QueryParam = { keyword: 'test-keyword' }

      // Act
      renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={queryParams}
          setQueryParams={vi.fn()}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(screen.getByPlaceholderText('common.operation.search')).toHaveValue('test-keyword')
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call setQueryParams when typing in search input', () => {
      // Arrange
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({
          data: { count: 20 },
          isLoading: false,
        }),
      )
      const queryParams: QueryParam = { keyword: '' }
      const setQueryParams = vi.fn()

      renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={queryParams}
          setQueryParams={setQueryParams}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Act
      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'updated' } })

      // Assert
      expect(setQueryParams).toHaveBeenCalledWith({ ...queryParams, keyword: 'updated' })
    })

    it('should call setQueryParams with empty keyword when clearing input', () => {
      // Arrange
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({
          data: { count: 20 },
          isLoading: false,
        }),
      )
      const queryParams: QueryParam = { keyword: 'prefill' }
      const setQueryParams = vi.fn()

      renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={queryParams}
          setQueryParams={setQueryParams}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Act
      const input = screen.getByPlaceholderText('common.operation.search')
      const clearButton = input.parentElement?.querySelector('div.cursor-pointer')
      if (clearButton)
        fireEvent.click(clearButton)

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
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({
          data: { count: 5 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={{ keyword: '' }}
          setQueryParams={vi.fn()}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(screen.getByPlaceholderText('common.operation.search')).toHaveValue('')
    })

    it('should handle undefined keyword in queryParams', () => {
      // Arrange
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({
          data: { count: 5 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={{ keyword: undefined }}
          setQueryParams={vi.fn()}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
    })

    it('should handle zero count', () => {
      // Arrange
      mockUseAnnotationsCount.mockReturnValue(
        createMockQueryResult<AnnotationsCountResponse>({
          data: { count: 0 },
          isLoading: false,
        }),
      )

      // Act
      renderWithQueryClient(
        <Filter
          appId={appId}
          queryParams={defaultQueryParams}
          setQueryParams={vi.fn()}
        >
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert - should still render when count is 0
      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
    })
  })
})
