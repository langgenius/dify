import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useSWR from 'swr'
import type { ILogsProps, QueryParam } from './index'
import Logs from './index'
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import type { WorkflowAppLogDetail, WorkflowLogsResponse, WorkflowRunDetail } from '@/models/log'
import { APP_PAGE_LIMIT } from '@/config'

// Mock dependencies
jest.mock('swr')
jest.mock('ahooks', () => ({
  useDebounce: <T,>(value: T): T => value,
}))
jest.mock('@/service/log', () => ({
  fetchWorkflowLogs: jest.fn(),
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))
jest.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      timezone: 'UTC',
    },
  }),
}))

// Mock child components
let mockQueryParams: QueryParam = { status: 'all', period: '2' }

jest.mock('./filter', () => ({
  __esModule: true,
  default: ({ queryParams, setQueryParams }: { queryParams: QueryParam; setQueryParams: (v: QueryParam) => void }) => {
    mockQueryParams = queryParams
    return (
      <div data-testid="filter">
        <button
          data-testid="filter-status-btn"
          onClick={() => setQueryParams({ ...queryParams, status: 'succeeded' })}
        >
          Change Status
        </button>
        <button
          data-testid="filter-period-btn"
          onClick={() => setQueryParams({ ...queryParams, period: '9' })}
        >
          Change Period
        </button>
        <input
          data-testid="filter-keyword-input"
          value={queryParams.keyword || ''}
          onChange={e => setQueryParams({ ...queryParams, keyword: e.target.value })}
        />
      </div>
    )
  },
  TIME_PERIOD_MAPPING: {
    1: { value: 0, name: 'today' },
    2: { value: 7, name: 'last7days' },
    9: { value: -1, name: 'allTime' },
  },
}))

jest.mock('./list', () => ({
  __esModule: true,
  default: ({ logs, appDetail, onRefresh }: { logs: WorkflowLogsResponse; appDetail: App; onRefresh: () => void }) => (
    <div data-testid="log-list">
      <span data-testid="log-count">{logs.data.length} logs</span>
      <span data-testid="app-id">{appDetail.id}</span>
      <button data-testid="refresh-btn" onClick={onRefresh}>Refresh</button>
    </div>
  ),
}))

jest.mock('@/app/components/app/log/empty-element', () => ({
  __esModule: true,
  default: ({ appDetail }: { appDetail: App }) => (
    <div data-testid="empty-element">
      No logs for {appDetail.name}
    </div>
  ),
}))

jest.mock('@/app/components/base/pagination', () => ({
  __esModule: true,
  default: ({
    current,
    onChange,
    total,
    limit,
    onLimitChange,
  }: {
    current: number
    onChange: (page: number) => void
    total: number
    limit: number
    onLimitChange: (limit: number) => void
  }) => (
    <div data-testid="pagination">
      <span data-testid="current-page">{current}</span>
      <span data-testid="total-items">{total}</span>
      <span data-testid="page-limit">{limit}</span>
      <button data-testid="next-page-btn" onClick={() => onChange(current + 1)}>Next</button>
      <button data-testid="prev-page-btn" onClick={() => onChange(current - 1)}>Prev</button>
      <button data-testid="change-limit-btn" onClick={() => onLimitChange(20)}>Change Limit</button>
    </div>
  ),
}))

jest.mock('@/app/components/base/loading', () => ({
  __esModule: true,
  default: ({ type }: { type?: string }) => (
    <div data-testid="loading" data-type={type}>Loading...</div>
  ),
}))

const mockedUseSWR = useSWR as jest.MockedFunction<typeof useSWR>

// Test data factories
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
  site: {} as App['site'],
  api_base_url: 'https://api.example.com',
  tags: [],
  access_mode: 'public_access' as App['access_mode'],
  ...overrides,
})

const createMockWorkflowRun = (overrides: Partial<WorkflowRunDetail> = {}): WorkflowRunDetail => ({
  id: 'run-1',
  version: '1.0.0',
  status: 'succeeded',
  elapsed_time: 1000,
  total_tokens: 100,
  total_price: 0.001,
  currency: 'USD',
  total_steps: 5,
  finished_at: Date.now(),
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
  total = 0,
): WorkflowLogsResponse => ({
  data,
  has_more: data.length < total,
  limit: APP_PAGE_LIMIT,
  total,
  page: 1,
})

describe('Logs (Workflow Log)', () => {
  const defaultProps: ILogsProps = {
    appDetail: createMockApp(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockQueryParams = { status: 'all', period: '2' }
  })

  // Tests for basic component rendering - verifies title, subtitle, and filter component are displayed
  describe('Rendering', () => {
    it('should render title and subtitle correctly', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByText('appLog.workflowTitle')).toBeInTheDocument()
      expect(screen.getByText('appLog.workflowSubtitle')).toBeInTheDocument()
    })

    it('should render filter component', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('filter')).toBeInTheDocument()
    })

    it('should pass correct initial query params to filter', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(mockQueryParams).toEqual({ status: 'all', period: '2' })
    })
  })

  // Tests for loading state - verifies loading spinner is shown when data is undefined
  describe('Loading State', () => {
    it('should show loading component when data is undefined', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: undefined,
        mutate: jest.fn(),
        isValidating: true,
        isLoading: true,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('loading')).toBeInTheDocument()
      expect(screen.getByTestId('loading')).toHaveAttribute('data-type', 'app')
    })

    it('should not show list or empty state when loading', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: undefined,
        mutate: jest.fn(),
        isValidating: true,
        isLoading: true,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId('log-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('empty-element')).not.toBeInTheDocument()
    })
  })

  // Tests for empty state - verifies empty element is shown when no logs exist
  describe('Empty State', () => {
    it('should show empty element when total is 0', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('empty-element')).toBeInTheDocument()
      expect(screen.getByText(`No logs for ${defaultProps.appDetail.name}`)).toBeInTheDocument()
    })

    it('should not show loading or list when empty', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
      expect(screen.queryByTestId('log-list')).not.toBeInTheDocument()
    })

    it('should not show pagination when empty', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId('pagination')).not.toBeInTheDocument()
    })
  })

  // Tests for list state - verifies log list is rendered with correct data and refresh functionality
  describe('List State', () => {
    it('should show log list when there are logs', () => {
      // Arrange
      const mockLogs = [
        createMockWorkflowLog({ id: 'log-1' }),
        createMockWorkflowLog({ id: 'log-2' }),
      ]
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, 2),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('log-list')).toBeInTheDocument()
      expect(screen.getByTestId('log-count')).toHaveTextContent('2 logs')
    })

    it('should pass correct app detail to list', () => {
      // Arrange
      const mockLogs = [createMockWorkflowLog()]
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, 1),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('app-id')).toHaveTextContent(defaultProps.appDetail.id)
    })

    it('should call mutate when refresh is triggered', async () => {
      // Arrange
      const user = userEvent.setup()
      const mockMutate = jest.fn()
      const mockLogs = [createMockWorkflowLog()]
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, 1),
        mutate: mockMutate,
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)
      await user.click(screen.getByTestId('refresh-btn'))

      // Assert
      expect(mockMutate).toHaveBeenCalledTimes(1)
    })
  })

  // Tests for pagination - verifies pagination visibility and page/limit state changes
  describe('Pagination', () => {
    it('should show pagination when total exceeds APP_PAGE_LIMIT', () => {
      // Arrange
      const mockLogs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, APP_PAGE_LIMIT + 5),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
      expect(screen.getByTestId('total-items')).toHaveTextContent(String(APP_PAGE_LIMIT + 5))
    })

    it('should not show pagination when total equals APP_PAGE_LIMIT', () => {
      // Arrange
      const mockLogs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, APP_PAGE_LIMIT),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId('pagination')).not.toBeInTheDocument()
    })

    it('should not show pagination when total is less than APP_PAGE_LIMIT', () => {
      // Arrange
      const mockLogs = [createMockWorkflowLog()]
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, 1),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId('pagination')).not.toBeInTheDocument()
    })

    it('should show current page as 0 initially', () => {
      // Arrange
      const mockLogs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, APP_PAGE_LIMIT + 10),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('current-page')).toHaveTextContent('0')
    })

    it('should update page when next button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const mockLogs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, APP_PAGE_LIMIT + 10),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)
      await user.click(screen.getByTestId('next-page-btn'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('current-page')).toHaveTextContent('1')
      })
    })

    it('should update limit when limit change is triggered', async () => {
      // Arrange
      const user = userEvent.setup()
      const mockLogs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, APP_PAGE_LIMIT + 10),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)
      await user.click(screen.getByTestId('change-limit-btn'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('page-limit')).toHaveTextContent('20')
      })
    })
  })

  // Tests for state management - verifies queryParams updates via filter interactions
  describe('State Management', () => {
    it('should update query params when filter status changes', async () => {
      // Arrange
      const user = userEvent.setup()
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)
      await user.click(screen.getByTestId('filter-status-btn'))

      // Assert
      await waitFor(() => {
        expect(mockQueryParams.status).toBe('succeeded')
      })
    })

    it('should update query params when filter period changes', async () => {
      // Arrange
      const user = userEvent.setup()
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)
      await user.click(screen.getByTestId('filter-period-btn'))

      // Assert
      await waitFor(() => {
        expect(mockQueryParams.period).toBe('9')
      })
    })

    it('should update query params when keyword changes', async () => {
      // Arrange
      const user = userEvent.setup()
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)
      await user.type(screen.getByTestId('filter-keyword-input'), 'test keyword')

      // Assert
      await waitFor(() => {
        expect(mockQueryParams.keyword).toBe('test keyword')
      })
    })
  })

  // Tests for API calls - verifies useSWR is called with correct URL and query parameters
  describe('API Calls', () => {
    it('should call useSWR with correct URL containing app ID', () => {
      // Arrange
      const customApp = createMockApp({ id: 'custom-app-123' })
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs appDetail={customApp} />)

      // Assert
      expect(mockedUseSWR).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/apps/custom-app-123/workflow-app-logs',
        }),
        expect.any(Function),
      )
    })

    it('should include page parameter in query (1-indexed)', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(mockedUseSWR).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            page: 1,
            detail: true,
            limit: APP_PAGE_LIMIT,
          }),
        }),
        expect.any(Function),
      )
    })

    it('should not include status in query when status is "all"', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      const lastCall = mockedUseSWR.mock.calls[mockedUseSWR.mock.calls.length - 1]
      const keyArg = lastCall?.[0] as { params?: Record<string, unknown> } | undefined
      expect(keyArg?.params).not.toHaveProperty('status')
    })

    it('should include date range when period is not "9" (all time)', () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      const lastCall = mockedUseSWR.mock.calls[mockedUseSWR.mock.calls.length - 1]
      const keyArg = lastCall?.[0] as { params?: Record<string, unknown> } | undefined
      expect(keyArg?.params).toHaveProperty('created_at__after')
      expect(keyArg?.params).toHaveProperty('created_at__before')
    })
  })

  // Tests for edge cases - verifies handling of state transitions, large data, and boundary conditions
  describe('Edge Cases', () => {
    it('should handle app with minimal required fields', () => {
      // Arrange
      const minimalApp = createMockApp({
        id: 'minimal-id',
        name: 'Minimal App',
      })
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act & Assert
      expect(() => render(<Logs appDetail={minimalApp} />)).not.toThrow()
    })

    it('should handle transition from loading to empty state', async () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: undefined,
        mutate: jest.fn(),
        isValidating: true,
        isLoading: true,
        error: undefined,
      })

      // Act
      const { rerender } = render(<Logs {...defaultProps} />)

      // Assert - loading state
      expect(screen.getByTestId('loading')).toBeInTheDocument()

      // Update mock and rerender
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })
      rerender(<Logs {...defaultProps} />)

      // Assert - empty state
      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
        expect(screen.getByTestId('empty-element')).toBeInTheDocument()
      })
    })

    it('should handle transition from loading to list state', async () => {
      // Arrange
      mockedUseSWR.mockReturnValue({
        data: undefined,
        mutate: jest.fn(),
        isValidating: true,
        isLoading: true,
        error: undefined,
      })

      // Act
      const { rerender } = render(<Logs {...defaultProps} />)

      // Assert - loading state
      expect(screen.getByTestId('loading')).toBeInTheDocument()

      // Update mock and rerender
      const mockLogs = [createMockWorkflowLog()]
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, 1),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })
      rerender(<Logs {...defaultProps} />)

      // Assert - list state
      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
        expect(screen.getByTestId('log-list')).toBeInTheDocument()
      })
    })

    it('should handle large number of logs correctly', () => {
      // Arrange
      const largeLogs = Array.from({ length: 100 }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(largeLogs, 1000),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('log-list')).toBeInTheDocument()
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
      expect(screen.getByTestId('total-items')).toHaveTextContent('1000')
    })

    it('should handle page navigation at boundary', async () => {
      // Arrange
      const user = userEvent.setup()
      const mockLogs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(mockLogs, APP_PAGE_LIMIT + 10),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs {...defaultProps} />)

      // Navigate forward twice
      await user.click(screen.getByTestId('next-page-btn'))
      await user.click(screen.getByTestId('next-page-btn'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('current-page')).toHaveTextContent('2')
      })

      // Navigate back
      await user.click(screen.getByTestId('prev-page-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('current-page')).toHaveTextContent('1')
      })
    })

    it('should render correctly when app has different modes', () => {
      // Arrange
      const advancedChatApp = createMockApp({
        id: 'advanced-chat-app',
        mode: 'advanced-chat' as AppModeEnum,
      })
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act & Assert
      expect(() => render(<Logs appDetail={advancedChatApp} />)).not.toThrow()
    })
  })

  // Tests for props variations - verifies component handles different app configurations correctly
  describe('Props Variations', () => {
    it('should handle different app icons', () => {
      // Arrange
      const imageIconApp = createMockApp({
        icon_type: 'image' as AppIconType,
        icon: 'file-id-123',
        icon_url: 'https://example.com/icon.png',
        icon_background: null,
      })
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act & Assert
      expect(() => render(<Logs appDetail={imageIconApp} />)).not.toThrow()
    })

    it('should handle app with tags', () => {
      // Arrange
      const taggedApp = createMockApp({
        tags: [
          { id: 'tag-1', name: 'Production', type: 'app', binding_count: 1 },
          { id: 'tag-2', name: 'Internal', type: 'app', binding_count: 2 },
        ],
      })
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act & Assert
      expect(() => render(<Logs appDetail={taggedApp} />)).not.toThrow()
    })

    it('should use correct app ID in API URL regardless of other app properties', () => {
      // Arrange
      const uniqueIdApp = createMockApp({
        id: 'unique-test-id-12345',
        name: 'App With Unique ID',
        description: 'This app has a unique ID',
      })
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs appDetail={uniqueIdApp} />)

      // Assert
      expect(mockedUseSWR).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/apps/unique-test-id-12345/workflow-app-logs',
        }),
        expect.any(Function),
      )
    })
  })
})
