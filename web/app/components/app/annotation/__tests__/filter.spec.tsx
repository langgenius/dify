import type { QueryParam } from '../filter'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Filter from '../filter'

const mockUseQuery = vi.fn()

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
    it('should render nothing when data is loading', async () => {
      // Arrange
      mockUseQuery.mockReturnValue(new Promise(() => {}))

      // Act
      const { container } = renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when data is undefined', async () => {
      // Arrange
      mockUseQuery.mockReturnValue(new Promise(() => {}))

      // Act
      const { container } = renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render filter and children when data is available', async () => {
      // Arrange
      mockUseQuery.mockResolvedValue({ count: 20 })

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(
        await screen.findByRole('searchbox', { name: 'common.operation.search' }),
      ).toBeInTheDocument()
      expect(screen.getByText(childContent)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should query the annotations count for appId', async () => {
      // Arrange
      mockUseQuery.mockResolvedValue({ count: 10 })

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(mockUseQuery).toHaveBeenCalledWith({ params: { app_id: appId } })
    })

    it('should display keyword value in input', async () => {
      // Arrange
      mockUseQuery.mockResolvedValue({ count: 10 })
      const queryParams: QueryParam = { keyword: 'test-keyword' }

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={queryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(await screen.findByRole('searchbox', { name: 'common.operation.search' })).toHaveValue(
        'test-keyword',
      )
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call setQueryParams when typing in search input', async () => {
      // Arrange
      mockUseQuery.mockResolvedValue({ count: 20 })
      const queryParams: QueryParam = { keyword: '' }
      const setQueryParams = vi.fn()

      renderWithQueryClient(
        <Filter appId={appId} queryParams={queryParams} setQueryParams={setQueryParams}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Act
      const input = await screen.findByRole('searchbox', { name: 'common.operation.search' })
      fireEvent.change(input, { target: { value: 'updated' } })

      // Assert
      expect(setQueryParams).toHaveBeenCalledWith({ ...queryParams, keyword: 'updated' })
    })

    it('should call setQueryParams with empty keyword when clearing input', async () => {
      // Arrange
      mockUseQuery.mockResolvedValue({ count: 20 })
      const queryParams: QueryParam = { keyword: 'prefill' }
      const setQueryParams = vi.fn()

      renderWithQueryClient(
        <Filter appId={appId} queryParams={queryParams} setQueryParams={setQueryParams}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Act
      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.clear' }))

      // Assert
      expect(setQueryParams).toHaveBeenCalledWith({ ...queryParams, keyword: '' })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty keyword in queryParams', async () => {
      // Arrange
      mockUseQuery.mockResolvedValue({ count: 5 })

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={{ keyword: '' }} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(await screen.findByRole('searchbox', { name: 'common.operation.search' })).toHaveValue(
        '',
      )
    })

    it('should handle undefined keyword in queryParams', async () => {
      // Arrange
      mockUseQuery.mockResolvedValue({ count: 5 })

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={{ keyword: undefined }} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert
      expect(
        await screen.findByRole('searchbox', { name: 'common.operation.search' }),
      ).toBeInTheDocument()
    })

    it('should handle zero count', async () => {
      // Arrange
      mockUseQuery.mockResolvedValue({ count: 0 })

      // Act
      renderWithQueryClient(
        <Filter appId={appId} queryParams={defaultQueryParams} setQueryParams={vi.fn()}>
          <div>{childContent}</div>
        </Filter>,
      )

      // Assert - should still render when count is 0
      expect(
        await screen.findByRole('searchbox', { name: 'common.operation.search' }),
      ).toBeInTheDocument()
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.count.get': (input) => mockUseQuery(input),
    }),
  }
})
