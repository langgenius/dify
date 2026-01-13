import type { UseQueryResult } from '@tanstack/react-query'
/**
 * Logs Container Component Tests
 *
 * Tests the main Logs container component which:
 * - Fetches workflow logs via TanStack Query
 * - Manages query parameters (status, period, keyword)
 * - Handles pagination
 * - Renders Filter, List, and Empty states
 *
 * Note: Individual component tests are in their respective spec files:
 * - filter.spec.tsx
 * - list.spec.tsx
 * - detail.spec.tsx
 * - trigger-by-display.spec.tsx
 */

import type { MockedFunction } from 'vitest'
import type { ILogsProps } from './index'
import type { WorkflowAppLogDetail, WorkflowLogsResponse, WorkflowRunDetail } from '@/models/log'
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { APP_PAGE_LIMIT } from '@/config'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import * as useLogModule from '@/service/use-log'
import { TIME_PERIOD_MAPPING } from './filter'
import Logs from './index'

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/service/use-log')

vi.mock('ahooks', () => ({
  useDebounce: <T,>(value: T) => value,
  useDebounceFn: (fn: (value: string) => void) => ({ run: fn }),
  useBoolean: (initial: boolean) => {
    const setters = {
      setTrue: vi.fn(),
      setFalse: vi.fn(),
      toggle: vi.fn(),
    }
    return [initial, setters] as const
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => <a href={href}>{children}</a>,
}))

// Mock the Run component to avoid complex dependencies
vi.mock('@/app/components/workflow/run', () => ({
  default: ({ runDetailUrl, tracingListUrl }: { runDetailUrl: string, tracingListUrl: string }) => (
    <div data-testid="workflow-run">
      <span data-testid="run-detail-url">{runDetailUrl}</span>
      <span data-testid="tracing-list-url">{tracingListUrl}</span>
    </div>
  ),
}))

const mockTrackEvent = vi.fn()
vi.mock('@/app/components/base/amplitude/utils', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => {
    return { theme: 'light' }
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { timezone: 'UTC' },
  }),
}))

// Mock WorkflowContextProvider
vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

const mockedUseWorkflowLogs = useLogModule.useWorkflowLogs as MockedFunction<typeof useLogModule.useWorkflowLogs>

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

const createMockQueryResult = <T,>(
  overrides: { data?: T, isLoading?: boolean, error?: Error | null } = {},
): UseQueryResult<T, Error> => {
  const isLoading = overrides.isLoading ?? false
  const error = overrides.error ?? null
  const data = overrides.data

  return {
    data,
    isLoading,
    error,
    refetch: vi.fn(),
    isError: !!error,
    isPending: isLoading,
    isSuccess: !isLoading && !error && data !== undefined,
    isFetching: isLoading,
    isRefetching: false,
    isLoadingError: false,
    isRefetchError: false,
    isInitialLoading: isLoading,
    isPaused: false,
    isEnabled: true,
    status: isLoading ? 'pending' : error ? 'error' : 'success',
    fetchStatus: isLoading ? 'fetching' : 'idle',
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isFetched: !isLoading,
    isFetchedAfterMount: !isLoading,
    isPlaceholderData: false,
    isStale: false,
    promise: Promise.resolve(data as T),
  } as UseQueryResult<T, Error>
}

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test app description',
  author_name: 'Test Author',
  icon_type: 'emoji' as AppIconType,
  icon: '🚀',
  icon_background: '#FFEAD5',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: 'workflow' as AppModeEnum,
  enable_site: true,
  enable_api: true,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as App['model_config'],
  app_model_config: {} as App['app_model_config'],
  created_at: Date.now(),
  updated_at: Date.now(),
  site: {
    access_token: 'token',
    app_base_url: 'https://example.com',
  } as App['site'],
  api_base_url: 'https://api.example.com',
  tags: [],
  access_mode: 'public_access' as App['access_mode'],
  ...overrides,
})

const createMockWorkflowRun = (overrides: Partial<WorkflowRunDetail> = {}): WorkflowRunDetail => ({
  id: 'run-1',
  version: '1.0.0',
  status: 'succeeded',
  elapsed_time: 1.234,
  total_tokens: 100,
  total_price: 0.001,
  currency: 'USD',
  total_steps: 5,
  finished_at: Date.now(),
  triggered_from: WorkflowRunTriggeredFrom.APP_RUN,
  ...overrides,
})

const createMockWorkflowLog = (overrides: Partial<WorkflowAppLogDetail> = {}): WorkflowAppLogDetail => ({
  id: 'log-1',
  workflow_run: createMockWorkflowRun(),
  created_from: 'web-app',
  created_by_role: 'account',
  created_by_account: {
    id: 'account-1',
    name: 'Test User',
    email: 'test@example.com',
  },
  created_at: Date.now(),
  ...overrides,
})

const createMockLogsResponse = (
  data: WorkflowAppLogDetail[] = [],
  total = data.length,
): WorkflowLogsResponse => ({
  data,
  has_more: data.length < total,
  limit: APP_PAGE_LIMIT,
  total,
  page: 1,
})

// ============================================================================
// Type-safe Mock Helper
// ============================================================================

type WorkflowLogsParams = {
  appId: string
  params?: Record<string, string | number | boolean | undefined>
}

const getMockCallParams = (): WorkflowLogsParams | undefined => {
  const lastCall = mockedUseWorkflowLogs.mock.calls.at(-1)
  return lastCall?.[0]
}

// ============================================================================
// Tests
// ============================================================================

describe('Logs Container', () => {
  const defaultProps: ILogsProps = {
    appDetail: createMockApp(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByText('appLog.workflowTitle')).toBeInTheDocument()
    })

    it('should render title and subtitle', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByText('appLog.workflowTitle')).toBeInTheDocument()
      expect(screen.getByText('appLog.workflowSubtitle')).toBeInTheDocument()
    })

    it('should render Filter component', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Loading State Tests
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should show loading spinner when data is undefined', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: undefined,
          isLoading: true,
        }),
      )

      // Act
      const { container } = renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    })

    it('should not show loading spinner when data is available', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([createMockWorkflowLog()], 1),
        }),
      )

      // Act
      const { container } = renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(container.querySelector('.spin-animation')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Empty State Tests
  // --------------------------------------------------------------------------
  describe('Empty State', () => {
    it('should render empty element when total is 0', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByText('appLog.table.empty.element.title')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Data Fetching Tests
  // --------------------------------------------------------------------------
  describe('Data Fetching', () => {
    it('should call useWorkflowLogs with correct appId and default params', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      const callArg = getMockCallParams()
      expect(callArg).toMatchObject({
        appId: defaultProps.appDetail.id,
        params: expect.objectContaining({
          page: 1,
          detail: true,
          limit: APP_PAGE_LIMIT,
        }),
      })
    })

    it('should include date filters for non-allTime periods', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      const callArg = getMockCallParams()
      expect(callArg?.params).toHaveProperty('created_at__after')
      expect(callArg?.params).toHaveProperty('created_at__before')
    })

    it('should not include status param when status is all', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      const callArg = getMockCallParams()
      expect(callArg?.params).not.toHaveProperty('status')
    })
  })

  // --------------------------------------------------------------------------
  // Filter Integration Tests
  // --------------------------------------------------------------------------
  describe('Filter Integration', () => {
    it('should update query when selecting status filter', async () => {
      // Arrange
      const user = userEvent.setup()
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      renderWithQueryClient(<Logs {...defaultProps} />)

      // Act
      await user.click(screen.getByText('All'))
      await user.click(await screen.findByText('Success'))

      // Assert
      await waitFor(() => {
        const lastCall = getMockCallParams()
        expect(lastCall?.params).toMatchObject({
          status: 'succeeded',
        })
      })
    })

    it('should update query when selecting period filter', async () => {
      // Arrange
      const user = userEvent.setup()
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      renderWithQueryClient(<Logs {...defaultProps} />)

      // Act
      await user.click(screen.getByText('appLog.filter.period.last7days'))
      await user.click(await screen.findByText('appLog.filter.period.allTime'))

      // Assert
      await waitFor(() => {
        const lastCall = getMockCallParams()
        expect(lastCall?.params).not.toHaveProperty('created_at__after')
        expect(lastCall?.params).not.toHaveProperty('created_at__before')
      })
    })

    it('should update query when typing keyword', async () => {
      // Arrange
      const user = userEvent.setup()
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      renderWithQueryClient(<Logs {...defaultProps} />)

      // Act
      const searchInput = screen.getByPlaceholderText('common.operation.search')
      await user.type(searchInput, 'test-keyword')

      // Assert
      await waitFor(() => {
        const lastCall = getMockCallParams()
        expect(lastCall?.params).toMatchObject({
          keyword: 'test-keyword',
        })
      })
    })
  })

  // --------------------------------------------------------------------------
  // Pagination Tests
  // --------------------------------------------------------------------------
  describe('Pagination', () => {
    it('should not render pagination when total is less than limit', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([createMockWorkflowLog()], 1),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    })

    it('should render pagination when total exceeds limit', () => {
      // Arrange
      const logs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }))

      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse(logs, APP_PAGE_LIMIT + 10),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // List Rendering Tests
  // --------------------------------------------------------------------------
  describe('List Rendering', () => {
    it('should render List component when data is available', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([createMockWorkflowLog()], 1),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should display log data in table', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([
            createMockWorkflowLog({
              workflow_run: createMockWorkflowRun({
                status: 'succeeded',
                total_tokens: 500,
              }),
            }),
          ], 1),
        }),
      )

      // Act
      renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByText('Success')).toBeInTheDocument()
      expect(screen.getByText('500')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // TIME_PERIOD_MAPPING Export Tests
  // --------------------------------------------------------------------------
  describe('TIME_PERIOD_MAPPING', () => {
    it('should export TIME_PERIOD_MAPPING with correct values', () => {
      expect(TIME_PERIOD_MAPPING['1']).toEqual({ value: 0, name: 'today' })
      expect(TIME_PERIOD_MAPPING['2']).toEqual({ value: 7, name: 'last7days' })
      expect(TIME_PERIOD_MAPPING['9']).toEqual({ value: -1, name: 'allTime' })
      expect(Object.keys(TIME_PERIOD_MAPPING)).toHaveLength(9)
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle different app modes', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([createMockWorkflowLog()], 1),
        }),
      )

      const chatApp = createMockApp({ mode: 'advanced-chat' as AppModeEnum })

      // Act
      renderWithQueryClient(<Logs appDetail={chatApp} />)

      // Assert
      expect(screen.queryByText('appLog.table.header.triggered_from')).not.toBeInTheDocument()
    })

    it('should handle error state from useWorkflowLogs', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: undefined,
          error: new Error('Failed to fetch'),
        }),
      )

      // Act
      const { container } = renderWithQueryClient(<Logs {...defaultProps} />)

      // Assert - should show loading state when data is undefined
      expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    })

    it('should handle app with different ID', () => {
      // Arrange
      mockedUseWorkflowLogs.mockReturnValue(
        createMockQueryResult<WorkflowLogsResponse>({
          data: createMockLogsResponse([], 0),
        }),
      )

      const customApp = createMockApp({ id: 'custom-app-123' })

      // Act
      renderWithQueryClient(<Logs appDetail={customApp} />)

      // Assert
      const callArg = getMockCallParams()
      expect(callArg?.appId).toBe('custom-app-123')
    })
  })
})
