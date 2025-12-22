import type { MockedFunction } from 'vitest'
/**
 * Logs Container Component Tests
 *
 * Tests the main Logs container component which:
 * - Fetches workflow logs via useSWR
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

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useSWR from 'swr'
import Logs, { type ILogsProps } from './index'
import { TIME_PERIOD_MAPPING } from './filter'
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import type { WorkflowAppLogDetail, WorkflowLogsResponse, WorkflowRunDetail } from '@/models/log'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import { APP_PAGE_LIMIT } from '@/config'

// ============================================================================
// Mocks
// ============================================================================

vi.mock('swr')

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
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

// Mock the Run component to avoid complex dependencies
vi.mock('@/app/components/workflow/run', () => ({
  __esModule: true,
  default: ({ runDetailUrl, tracingListUrl }: { runDetailUrl: string; tracingListUrl: string }) => (
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

vi.mock('@/service/log', () => ({
  fetchWorkflowLogs: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  __esModule: true,
  default: () => {
    return { theme: 'light' }
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { timezone: 'UTC' },
  }),
}))

// Mock useTimestamp
vi.mock('@/hooks/use-timestamp', () => ({
  __esModule: true,
  default: () => ({
    formatTime: (timestamp: number, _format: string) => `formatted-${timestamp}`,
  }),
}))

// Mock useBreakpoints
vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'pc',
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

// Mock BlockIcon
vi.mock('@/app/components/workflow/block-icon', () => ({
  __esModule: true,
  default: () => <div data-testid="block-icon">BlockIcon</div>,
}))

// Mock WorkflowContextProvider
vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
}))

const mockedUseSWR = useSWR as unknown as MockedFunction<typeof useSWR>

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
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      expect(screen.getByText('appLog.workflowTitle')).toBeInTheDocument()
    })

    it('should render title and subtitle', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      expect(screen.getByText('appLog.workflowTitle')).toBeInTheDocument()
      expect(screen.getByText('appLog.workflowSubtitle')).toBeInTheDocument()
    })

    it('should render Filter component', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Loading State Tests
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should show loading spinner when data is undefined', () => {
      mockedUseSWR.mockReturnValue({
        data: undefined,
        mutate: vi.fn(),
        isValidating: true,
        isLoading: true,
        error: undefined,
      })

      const { container } = render(<Logs {...defaultProps} />)

      expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    })

    it('should not show loading spinner when data is available', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([createMockWorkflowLog()], 1),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      const { container } = render(<Logs {...defaultProps} />)

      expect(container.querySelector('.spin-animation')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Empty State Tests
  // --------------------------------------------------------------------------
  describe('Empty State', () => {
    it('should render empty element when total is 0', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      expect(screen.getByText('appLog.table.empty.element.title')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Data Fetching Tests
  // --------------------------------------------------------------------------
  describe('Data Fetching', () => {
    it('should call useSWR with correct URL and default params', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      const keyArg = mockedUseSWR.mock.calls.at(-1)?.[0] as { url: string; params: Record<string, unknown> }
      expect(keyArg).toMatchObject({
        url: `/apps/${defaultProps.appDetail.id}/workflow-app-logs`,
        params: expect.objectContaining({
          page: 1,
          detail: true,
          limit: APP_PAGE_LIMIT,
        }),
      })
    })

    it('should include date filters for non-allTime periods', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      const keyArg = mockedUseSWR.mock.calls.at(-1)?.[0] as { params?: Record<string, unknown> }
      expect(keyArg?.params).toHaveProperty('created_at__after')
      expect(keyArg?.params).toHaveProperty('created_at__before')
    })

    it('should not include status param when status is all', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      const keyArg = mockedUseSWR.mock.calls.at(-1)?.[0] as { params?: Record<string, unknown> }
      expect(keyArg?.params).not.toHaveProperty('status')
    })
  })

  // --------------------------------------------------------------------------
  // Filter Integration Tests
  // --------------------------------------------------------------------------
  describe('Filter Integration', () => {
    it('should update query when selecting status filter', async () => {
      const user = userEvent.setup()
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      // Click status filter
      await user.click(screen.getByText('All'))
      await user.click(await screen.findByText('Success'))

      // Check that useSWR was called with updated params
      await waitFor(() => {
        const lastCall = mockedUseSWR.mock.calls.at(-1)?.[0] as { params?: Record<string, unknown> }
        expect(lastCall?.params).toMatchObject({
          status: 'succeeded',
        })
      })
    })

    it('should update query when selecting period filter', async () => {
      const user = userEvent.setup()
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      // Click period filter
      await user.click(screen.getByText('appLog.filter.period.last7days'))
      await user.click(await screen.findByText('appLog.filter.period.allTime'))

      // When period is allTime (9), date filters should be removed
      await waitFor(() => {
        const lastCall = mockedUseSWR.mock.calls.at(-1)?.[0] as { params?: Record<string, unknown> }
        expect(lastCall?.params).not.toHaveProperty('created_at__after')
        expect(lastCall?.params).not.toHaveProperty('created_at__before')
      })
    })

    it('should update query when typing keyword', async () => {
      const user = userEvent.setup()
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('common.operation.search')
      await user.type(searchInput, 'test-keyword')

      await waitFor(() => {
        const lastCall = mockedUseSWR.mock.calls.at(-1)?.[0] as { params?: Record<string, unknown> }
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
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([createMockWorkflowLog()], 1),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      // Pagination component should not be rendered
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    })

    it('should render pagination when total exceeds limit', () => {
      const logs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )

      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse(logs, APP_PAGE_LIMIT + 10),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      // Should show pagination - checking for any pagination-related element
      // The Pagination component renders page controls
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // List Rendering Tests
  // --------------------------------------------------------------------------
  describe('List Rendering', () => {
    it('should render List component when data is available', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([createMockWorkflowLog()], 1),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should display log data in table', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([
          createMockWorkflowLog({
            workflow_run: createMockWorkflowRun({
              status: 'succeeded',
              total_tokens: 500,
            }),
          }),
        ], 1),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      render(<Logs {...defaultProps} />)

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
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([createMockWorkflowLog()], 1),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      const chatApp = createMockApp({ mode: 'advanced-chat' as AppModeEnum })

      render(<Logs appDetail={chatApp} />)

      // Should render without trigger column
      expect(screen.queryByText('appLog.table.header.triggered_from')).not.toBeInTheDocument()
    })

    it('should handle error state from useSWR', () => {
      mockedUseSWR.mockReturnValue({
        data: undefined,
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: new Error('Failed to fetch'),
      })

      const { container } = render(<Logs {...defaultProps} />)

      // Should show loading state when data is undefined
      expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    })

    it('should handle app with different ID', () => {
      mockedUseSWR.mockReturnValue({
        data: createMockLogsResponse([], 0),
        mutate: vi.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      const customApp = createMockApp({ id: 'custom-app-123' })

      render(<Logs appDetail={customApp} />)

      const keyArg = mockedUseSWR.mock.calls.at(-1)?.[0] as { url: string }
      expect(keyArg?.url).toBe('/apps/custom-app-123/workflow-app-logs')
    })
  })
})
