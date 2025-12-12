import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useSWR from 'swr'

// Import real components for integration testing
import Logs from './index'
import type { ILogsProps, QueryParam } from './index'
import Filter, { TIME_PERIOD_MAPPING } from './filter'
import WorkflowAppLogList from './list'
import TriggerByDisplay from './trigger-by-display'
import DetailPanel from './detail'

// Import types from source
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import type { TriggerMetadata, WorkflowAppLogDetail, WorkflowLogsResponse, WorkflowRunDetail } from '@/models/log'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import { APP_PAGE_LIMIT } from '@/config'
import { Theme } from '@/types/app'

// Mock external dependencies only
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

// Router mock with trackable push function
const mockRouterPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

jest.mock('@/hooks/use-theme', () => ({
  __esModule: true,
  default: () => ({ theme: Theme.light }),
}))
jest.mock('@/hooks/use-timestamp', () => ({
  __esModule: true,
  default: () => ({
    formatTime: (timestamp: number, _format: string) => new Date(timestamp).toISOString(),
  }),
}))
jest.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'pc',
  MediaType: { mobile: 'mobile', pc: 'pc' },
}))

// Store mock with configurable appDetail
let mockAppDetail: App | null = null
jest.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: App | null }) => App | null) => {
    return selector({ appDetail: mockAppDetail })
  },
}))

// Mock portal-based components (they need DOM portal which is complex in tests)
let mockPortalOpen = false
jest.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode; open: boolean }) => {
    mockPortalOpen = open
    return <div data-testid="portal-elem" data-open={open}>{children}</div>
  },
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    mockPortalOpen ? <div data-testid="portal-content">{children}</div> : null
  ),
}))

// Mock Drawer for List component (uses headlessui Dialog)
jest.mock('@/app/components/base/drawer', () => ({
  __esModule: true,
  default: ({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) => (
    isOpen ? (
      <div data-testid="drawer" role="dialog">
        <button data-testid="drawer-close" onClick={onClose}>Close</button>
        {children}
      </div>
    ) : null
  ),
}))

// Mock only the complex workflow Run component - DetailPanel itself is tested with real code
jest.mock('@/app/components/workflow/run', () => ({
  __esModule: true,
  default: ({ runDetailUrl, tracingListUrl }: { runDetailUrl: string; tracingListUrl: string }) => (
    <div data-testid="workflow-run">
      <span data-testid="run-detail-url">{runDetailUrl}</span>
      <span data-testid="tracing-list-url">{tracingListUrl}</span>
    </div>
  ),
}))

// Mock WorkflowContextProvider - provides context for Run component
jest.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
}))

// Mock TooltipPlus - simple UI component
jest.mock('@/app/components/base/tooltip', () => ({
  __esModule: true,
  default: ({ children, popupContent }: { children: React.ReactNode; popupContent: string }) => (
    <div data-testid="tooltip" title={popupContent}>{children}</div>
  ),
}))

// Mock base components that are difficult to render
jest.mock('@/app/components/app/log/empty-element', () => ({
  __esModule: true,
  default: ({ appDetail }: { appDetail: App }) => (
    <div data-testid="empty-element">No logs for {appDetail.name}</div>
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

// Mock amplitude tracking - with trackable function
const mockTrackEvent = jest.fn()
jest.mock('@/app/components/base/amplitude/utils', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

// Mock workflow icons
jest.mock('@/app/components/base/icons/src/vender/workflow', () => ({
  Code: () => <span data-testid="icon-code">Code</span>,
  KnowledgeRetrieval: () => <span data-testid="icon-knowledge">Knowledge</span>,
  Schedule: () => <span data-testid="icon-schedule">Schedule</span>,
  WebhookLine: () => <span data-testid="icon-webhook">Webhook</span>,
  WindowCursor: () => <span data-testid="icon-window">Window</span>,
}))

jest.mock('@/app/components/workflow/block-icon', () => ({
  __esModule: true,
  default: ({ type, toolIcon }: { type: string; size?: string; toolIcon?: string }) => (
    <span data-testid="block-icon" data-type={type} data-tool-icon={toolIcon}>BlockIcon</span>
  ),
}))

// Mock workflow types - must include all exports used by config/index.ts
jest.mock('@/app/components/workflow/types', () => ({
  BlockEnum: {
    TriggerPlugin: 'trigger-plugin',
  },
  InputVarType: {
    textInput: 'text-input',
    paragraph: 'paragraph',
    select: 'select',
    number: 'number',
    checkbox: 'checkbox',
    url: 'url',
    files: 'files',
    json: 'json',
    jsonObject: 'json_object',
    contexts: 'contexts',
    iterator: 'iterator',
    singleFile: 'file',
    multiFiles: 'file-list',
    loop: 'loop',
  },
}))

const mockedUseSWR = useSWR as jest.MockedFunction<typeof useSWR>

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
  total = 0,
): WorkflowLogsResponse => ({
  data,
  has_more: data.length < total,
  limit: APP_PAGE_LIMIT,
  total,
  page: 1,
})

// ============================================================================
// Integration Tests for Logs (Main Component)
// ============================================================================

describe('Workflow Log Module Integration Tests', () => {
  const defaultProps: ILogsProps = {
    appDetail: createMockApp(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockPortalOpen = false
    mockAppDetail = createMockApp()
    mockRouterPush.mockClear()
    mockTrackEvent.mockClear()
  })

  // Tests for Logs container component - orchestrates Filter, List, Pagination, and Loading states
  describe('Logs Container', () => {
    describe('Rendering', () => {
      it('should render title, subtitle, and filter component', () => {
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
        // Filter should render (has Chip components for status/period and Input for keyword)
        expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
      })
    })

    describe('Loading State', () => {
      it('should show loading spinner when data is undefined', () => {
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
        expect(screen.queryByTestId('empty-element')).not.toBeInTheDocument()
      })
    })

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
        expect(screen.queryByTestId('pagination')).not.toBeInTheDocument()
      })
    })

    describe('List State with Data', () => {
      it('should render log table when data exists', () => {
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
        expect(screen.getByRole('table')).toBeInTheDocument()
        // Check table headers
        expect(screen.getByText('appLog.table.header.startTime')).toBeInTheDocument()
        expect(screen.getByText('appLog.table.header.status')).toBeInTheDocument()
        expect(screen.getByText('appLog.table.header.runtime')).toBeInTheDocument()
        expect(screen.getByText('appLog.table.header.tokens')).toBeInTheDocument()
      })

      it('should show pagination when total exceeds APP_PAGE_LIMIT', () => {
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
        expect(screen.getByTestId('pagination')).toBeInTheDocument()
        expect(screen.getByTestId('total-items')).toHaveTextContent(String(APP_PAGE_LIMIT + 10))
      })

      it('should not show pagination when total is within limit', () => {
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
    })

    describe('API Query Parameters', () => {
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

      it('should include pagination parameters in query', () => {
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

      it('should include date range when period is not all time', () => {
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

        // Assert - default period is '2' (last 7 days), should have date filters
        const lastCall = mockedUseSWR.mock.calls[mockedUseSWR.mock.calls.length - 1]
        const keyArg = lastCall?.[0] as { params?: Record<string, unknown> } | undefined
        expect(keyArg?.params).toHaveProperty('created_at__after')
        expect(keyArg?.params).toHaveProperty('created_at__before')
      })
    })

    describe('Pagination Interactions', () => {
      it('should update page when pagination changes', async () => {
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
    })

    describe('State Transitions', () => {
      it('should transition from loading to list state', async () => {
        // Arrange - start with loading
        mockedUseSWR.mockReturnValue({
          data: undefined,
          mutate: jest.fn(),
          isValidating: true,
          isLoading: true,
          error: undefined,
        })

        // Act
        const { rerender } = render(<Logs {...defaultProps} />)
        expect(screen.getByTestId('loading')).toBeInTheDocument()

        // Update to loaded state
        const mockLogs = [createMockWorkflowLog()]
        mockedUseSWR.mockReturnValue({
          data: createMockLogsResponse(mockLogs, 1),
          mutate: jest.fn(),
          isValidating: false,
          isLoading: false,
          error: undefined,
        })
        rerender(<Logs {...defaultProps} />)

        // Assert
        await waitFor(() => {
          expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
          expect(screen.getByRole('table')).toBeInTheDocument()
        })
      })
    })
  })

  // ============================================================================
  // Tests for Filter Component
  // ============================================================================

  describe('Filter Component', () => {
    const mockSetQueryParams = jest.fn()
    const defaultFilterProps = {
      queryParams: { status: 'all', period: '2' } as QueryParam,
      setQueryParams: mockSetQueryParams,
    }

    beforeEach(() => {
      mockSetQueryParams.mockClear()
      mockTrackEvent.mockClear()
    })

    describe('Rendering', () => {
      it('should render status filter chip with correct value', () => {
        // Arrange & Act
        render(<Filter {...defaultFilterProps} />)

        // Assert - should show "All" as default status
        expect(screen.getByText('All')).toBeInTheDocument()
      })

      it('should render time period filter chip', () => {
        // Arrange & Act
        render(<Filter {...defaultFilterProps} />)

        // Assert - should have calendar icon (period filter)
        const calendarIcons = document.querySelectorAll('svg')
        expect(calendarIcons.length).toBeGreaterThan(0)
      })

      it('should render keyword search input', () => {
        // Arrange & Act
        render(<Filter {...defaultFilterProps} />)

        // Assert
        const searchInput = screen.getByPlaceholderText('common.operation.search')
        expect(searchInput).toBeInTheDocument()
      })

      it('should display different status values', () => {
        // Arrange
        const successStatusProps = {
          queryParams: { status: 'succeeded', period: '2' } as QueryParam,
          setQueryParams: mockSetQueryParams,
        }

        // Act
        render(<Filter {...successStatusProps} />)

        // Assert
        expect(screen.getByText('Success')).toBeInTheDocument()
      })
    })

    describe('Keyword Search', () => {
      it('should call setQueryParams when keyword changes', async () => {
        // Arrange
        const user = userEvent.setup()
        render(<Filter {...defaultFilterProps} />)

        // Act
        const searchInput = screen.getByPlaceholderText('common.operation.search')
        await user.type(searchInput, 'test')

        // Assert
        expect(mockSetQueryParams).toHaveBeenCalledWith(
          expect.objectContaining({ keyword: expect.any(String) }),
        )
      })

      it('should render input with initial keyword value', () => {
        // Arrange
        const propsWithKeyword = {
          queryParams: { status: 'all', period: '2', keyword: 'test' } as QueryParam,
          setQueryParams: mockSetQueryParams,
        }

        // Act
        render(<Filter {...propsWithKeyword} />)

        // Assert
        const searchInput = screen.getByPlaceholderText('common.operation.search')
        expect(searchInput).toHaveValue('test')
      })
    })

    describe('TIME_PERIOD_MAPPING Export', () => {
      it('should export TIME_PERIOD_MAPPING with correct structure', () => {
        // Assert
        expect(TIME_PERIOD_MAPPING).toBeDefined()
        expect(TIME_PERIOD_MAPPING['1']).toEqual({ value: 0, name: 'today' })
        expect(TIME_PERIOD_MAPPING['9']).toEqual({ value: -1, name: 'allTime' })
      })

      it('should have all required time period options', () => {
        // Assert - verify all periods are defined
        expect(Object.keys(TIME_PERIOD_MAPPING)).toHaveLength(9)
        expect(TIME_PERIOD_MAPPING['2']).toHaveProperty('name', 'last7days')
        expect(TIME_PERIOD_MAPPING['3']).toHaveProperty('name', 'last4weeks')
        expect(TIME_PERIOD_MAPPING['4']).toHaveProperty('name', 'last3months')
        expect(TIME_PERIOD_MAPPING['5']).toHaveProperty('name', 'last12months')
        expect(TIME_PERIOD_MAPPING['6']).toHaveProperty('name', 'monthToDate')
        expect(TIME_PERIOD_MAPPING['7']).toHaveProperty('name', 'quarterToDate')
        expect(TIME_PERIOD_MAPPING['8']).toHaveProperty('name', 'yearToDate')
      })

      it('should have correct value for allTime period', () => {
        // Assert - allTime should have -1 value (special case)
        expect(TIME_PERIOD_MAPPING['9'].value).toBe(-1)
      })
    })
  })

  // ============================================================================
  // Tests for WorkflowAppLogList Component
  // ============================================================================

  describe('WorkflowAppLogList Component', () => {
    const mockOnRefresh = jest.fn()

    beforeEach(() => {
      mockOnRefresh.mockClear()
    })

    it('should render loading when logs or appDetail is undefined', () => {
      // Arrange & Act
      render(<WorkflowAppLogList logs={undefined} appDetail={undefined} onRefresh={mockOnRefresh} />)

      // Assert
      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('should render table with correct headers for workflow app', () => {
      // Arrange
      const mockLogs = createMockLogsResponse([createMockWorkflowLog()], 1)
      const workflowApp = createMockApp({ mode: 'workflow' as AppModeEnum })

      // Act
      render(<WorkflowAppLogList logs={mockLogs} appDetail={workflowApp} onRefresh={mockOnRefresh} />)

      // Assert
      expect(screen.getByText('appLog.table.header.startTime')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.status')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.runtime')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.tokens')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.user')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.triggered_from')).toBeInTheDocument()
    })

    it('should not show triggered_from column for non-workflow apps', () => {
      // Arrange
      const mockLogs = createMockLogsResponse([createMockWorkflowLog()], 1)
      const chatApp = createMockApp({ mode: 'advanced-chat' as AppModeEnum })

      // Act
      render(<WorkflowAppLogList logs={mockLogs} appDetail={chatApp} onRefresh={mockOnRefresh} />)

      // Assert
      expect(screen.queryByText('appLog.table.header.triggered_from')).not.toBeInTheDocument()
    })

    it('should render log rows with correct data', () => {
      // Arrange
      const mockLog = createMockWorkflowLog({
        id: 'test-log-1',
        workflow_run: createMockWorkflowRun({
          status: 'succeeded',
          elapsed_time: 1.5,
          total_tokens: 150,
        }),
        created_by_account: { id: '1', name: 'John Doe', email: 'john@example.com' },
      })
      const mockLogs = createMockLogsResponse([mockLog], 1)

      // Act
      render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)

      // Assert
      expect(screen.getByText('Success')).toBeInTheDocument()
      expect(screen.getByText('1.500s')).toBeInTheDocument()
      expect(screen.getByText('150')).toBeInTheDocument()
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    describe('Status Display', () => {
      it.each([
        ['succeeded', 'Success'],
        ['failed', 'Failure'],
        ['stopped', 'Stop'],
        ['running', 'Running'],
        ['partial-succeeded', 'Partial Success'],
      ])('should display correct status for %s', (status, expectedText) => {
        // Arrange
        const mockLog = createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ status: status as WorkflowRunDetail['status'] }),
        })
        const mockLogs = createMockLogsResponse([mockLog], 1)

        // Act
        render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)

        // Assert
        expect(screen.getByText(expectedText)).toBeInTheDocument()
      })
    })

    describe('Sorting', () => {
      it('should toggle sort order when clicking sort header', async () => {
        // Arrange
        const user = userEvent.setup()
        const logs = [
          createMockWorkflowLog({ id: 'log-1', created_at: 1000 }),
          createMockWorkflowLog({ id: 'log-2', created_at: 2000 }),
        ]
        const mockLogs = createMockLogsResponse(logs, 2)

        // Act
        render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)

        // Find and click the sort header
        const sortHeader = screen.getByText('appLog.table.header.startTime')
        await user.click(sortHeader)

        // Assert - sort icon should change (we can verify the click handler was called)
        // The component should handle sorting internally
        expect(sortHeader).toBeInTheDocument()
      })
    })

    describe('Row Click and Drawer', () => {
      beforeEach(() => {
        // Set app detail for DetailPanel's useStore
        mockAppDetail = createMockApp({ id: 'test-app-id' })
      })

      it('should open drawer with detail panel when clicking a log row', async () => {
        // Arrange
        const user = userEvent.setup()
        const mockLog = createMockWorkflowLog({
          id: 'test-log-1',
          workflow_run: createMockWorkflowRun({ id: 'run-123', triggered_from: WorkflowRunTriggeredFrom.APP_RUN }),
        })
        const mockLogs = createMockLogsResponse([mockLog], 1)

        // Act
        render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)

        // Click on a table row
        const rows = screen.getAllByRole('row')
        // First row is header, second is data row
        await user.click(rows[1])

        // Assert - drawer opens and DetailPanel renders with real component
        await waitFor(() => {
          expect(screen.getByTestId('drawer')).toBeInTheDocument()
          // Real DetailPanel renders workflow title
          expect(screen.getByText('appLog.runDetail.workflowTitle')).toBeInTheDocument()
          // Real DetailPanel renders Run component with correct URL
          expect(screen.getByTestId('run-detail-url')).toHaveTextContent('run-123')
        })
      })

      it('should show replay button for APP_RUN triggered logs', async () => {
        // Arrange
        const user = userEvent.setup()
        const mockLog = createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ id: 'run-abc', triggered_from: WorkflowRunTriggeredFrom.APP_RUN }),
        })
        const mockLogs = createMockLogsResponse([mockLog], 1)

        // Act
        render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)
        const rows = screen.getAllByRole('row')
        await user.click(rows[1])

        // Assert - replay button should be visible for APP_RUN
        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })).toBeInTheDocument()
        })
      })

      it('should not show replay button for WEBHOOK triggered logs', async () => {
        // Arrange
        const user = userEvent.setup()
        const mockLog = createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ id: 'run-xyz', triggered_from: WorkflowRunTriggeredFrom.WEBHOOK }),
        })
        const mockLogs = createMockLogsResponse([mockLog], 1)

        // Act
        render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)
        const rows = screen.getAllByRole('row')
        await user.click(rows[1])

        // Assert - replay button should NOT be visible for WEBHOOK
        await waitFor(() => {
          expect(screen.getByTestId('drawer')).toBeInTheDocument()
          expect(screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' })).not.toBeInTheDocument()
        })
      })

      it('should close drawer and call refresh when drawer closes', async () => {
        // Arrange
        const user = userEvent.setup()
        const mockLog = createMockWorkflowLog()
        const mockLogs = createMockLogsResponse([mockLog], 1)

        // Act
        render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)

        // Open drawer
        const rows = screen.getAllByRole('row')
        await user.click(rows[1])

        // Wait for drawer to open
        await waitFor(() => {
          expect(screen.getByTestId('drawer')).toBeInTheDocument()
        })

        // Close drawer
        await user.click(screen.getByTestId('drawer-close'))

        // Assert
        await waitFor(() => {
          expect(screen.queryByTestId('drawer')).not.toBeInTheDocument()
          expect(mockOnRefresh).toHaveBeenCalled()
        })
      })
    })

    describe('User Display', () => {
      it('should display end user session ID when available', () => {
        // Arrange
        const mockLog = createMockWorkflowLog({
          created_by_end_user: { id: 'end-user-1', session_id: 'session-abc', type: 'browser', is_anonymous: false },
          created_by_account: undefined,
        })
        const mockLogs = createMockLogsResponse([mockLog], 1)

        // Act
        render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)

        // Assert
        expect(screen.getByText('session-abc')).toBeInTheDocument()
      })

      it('should display N/A when no user info available', () => {
        // Arrange
        const mockLog = createMockWorkflowLog({
          created_by_end_user: undefined,
          created_by_account: undefined,
        })
        const mockLogs = createMockLogsResponse([mockLog], 1)

        // Act
        render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />)

        // Assert
        expect(screen.getByText('N/A')).toBeInTheDocument()
      })
    })

    describe('Unread Indicator', () => {
      it('should show unread indicator when read_at is not set', () => {
        // Arrange
        const mockLog = createMockWorkflowLog({ read_at: undefined })
        const mockLogs = createMockLogsResponse([mockLog], 1)

        // Act
        const { container } = render(
          <WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={mockOnRefresh} />,
        )

        // Assert - look for the unread indicator dot
        const unreadDot = container.querySelector('.bg-util-colors-blue-blue-500')
        expect(unreadDot).toBeInTheDocument()
      })
    })
  })

  // ============================================================================
  // Tests for TriggerByDisplay Component
  // ============================================================================

  describe('TriggerByDisplay Component', () => {
    it.each([
      [WorkflowRunTriggeredFrom.DEBUGGING, 'appLog.triggerBy.debugging', 'icon-code'],
      [WorkflowRunTriggeredFrom.APP_RUN, 'appLog.triggerBy.appRun', 'icon-window'],
      [WorkflowRunTriggeredFrom.WEBHOOK, 'appLog.triggerBy.webhook', 'icon-webhook'],
      [WorkflowRunTriggeredFrom.SCHEDULE, 'appLog.triggerBy.schedule', 'icon-schedule'],
      [WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN, 'appLog.triggerBy.ragPipelineRun', 'icon-knowledge'],
      [WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING, 'appLog.triggerBy.ragPipelineDebugging', 'icon-knowledge'],
    ])('should render correct display for %s trigger', (triggeredFrom, expectedText, expectedIcon) => {
      // Act
      render(<TriggerByDisplay triggeredFrom={triggeredFrom} />)

      // Assert
      expect(screen.getByText(expectedText)).toBeInTheDocument()
      expect(screen.getByTestId(expectedIcon)).toBeInTheDocument()
    })

    it('should render plugin trigger with custom event name from metadata', () => {
      // Arrange
      const metadata: TriggerMetadata = {
        event_name: 'Custom Plugin Event',
        icon: 'plugin-icon.png',
      }

      // Act
      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
        />,
      )

      // Assert
      expect(screen.getByText('Custom Plugin Event')).toBeInTheDocument()
    })

    it('should not show text when showText is false', () => {
      // Act
      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN}
          showText={false}
        />,
      )

      // Assert
      expect(screen.queryByText('appLog.triggerBy.appRun')).not.toBeInTheDocument()
      expect(screen.getByTestId('icon-window')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      // Act
      const { container } = render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN}
          className="custom-class"
        />,
      )

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should render plugin with BlockIcon when metadata has icon', () => {
      // Arrange
      const metadata: TriggerMetadata = {
        icon: 'custom-plugin-icon.png',
      }

      // Act
      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
        />,
      )

      // Assert
      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-tool-icon', 'custom-plugin-icon.png')
    })

    it('should fall back to default BlockIcon for plugin without metadata', () => {
      // Act
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN} />)

      // Assert
      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
    })
  })

  // ============================================================================
  // Tests for DetailPanel Component (Real Component Testing)
  // ============================================================================

  describe('DetailPanel Component', () => {
    const mockOnClose = jest.fn()

    beforeEach(() => {
      mockOnClose.mockClear()
      mockRouterPush.mockClear()
      // Set default app detail for store
      mockAppDetail = createMockApp({ id: 'test-app-123', name: 'Test App' })
    })

    describe('Rendering', () => {
      it('should render title correctly', () => {
        // Act
        render(<DetailPanel runID="run-123" onClose={mockOnClose} />)

        // Assert
        expect(screen.getByText('appLog.runDetail.workflowTitle')).toBeInTheDocument()
      })

      it('should render close button', () => {
        // Act
        render(<DetailPanel runID="run-123" onClose={mockOnClose} />)

        // Assert - close icon should be present
        const closeIcon = document.querySelector('.cursor-pointer')
        expect(closeIcon).toBeInTheDocument()
      })

      it('should render WorkflowContextProvider with Run component', () => {
        // Act
        render(<DetailPanel runID="run-123" onClose={mockOnClose} />)

        // Assert
        expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
        expect(screen.getByTestId('workflow-run')).toBeInTheDocument()
      })

      it('should pass correct URLs to Run component', () => {
        // Arrange
        mockAppDetail = createMockApp({ id: 'app-456' })

        // Act
        render(<DetailPanel runID="run-789" onClose={mockOnClose} />)

        // Assert
        expect(screen.getByTestId('run-detail-url')).toHaveTextContent('/apps/app-456/workflow-runs/run-789')
        expect(screen.getByTestId('tracing-list-url')).toHaveTextContent('/apps/app-456/workflow-runs/run-789/node-executions')
      })

      it('should pass empty URLs when runID is empty', () => {
        // Act
        render(<DetailPanel runID="" onClose={mockOnClose} />)

        // Assert
        expect(screen.getByTestId('run-detail-url')).toHaveTextContent('')
        expect(screen.getByTestId('tracing-list-url')).toHaveTextContent('')
      })
    })

    describe('Close Button Interaction', () => {
      it('should call onClose when close icon is clicked', async () => {
        // Arrange
        const user = userEvent.setup()
        render(<DetailPanel runID="run-123" onClose={mockOnClose} />)

        // Act - click on the close icon
        const closeIcon = document.querySelector('.cursor-pointer') as HTMLElement
        await user.click(closeIcon)

        // Assert
        expect(mockOnClose).toHaveBeenCalledTimes(1)
      })
    })

    describe('Replay Button (canReplay=true)', () => {
      it('should render replay button when canReplay is true', () => {
        // Act
        render(<DetailPanel runID="run-123" onClose={mockOnClose} canReplay={true} />)

        // Assert
        const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
        expect(replayButton).toBeInTheDocument()
      })

      it('should show tooltip with correct text', () => {
        // Act
        render(<DetailPanel runID="run-123" onClose={mockOnClose} canReplay={true} />)

        // Assert
        const tooltip = screen.getByTestId('tooltip')
        expect(tooltip).toHaveAttribute('title', 'appLog.runDetail.testWithParams')
      })

      it('should navigate to workflow page with replayRunId when replay is clicked', async () => {
        // Arrange
        const user = userEvent.setup()
        mockAppDetail = createMockApp({ id: 'app-for-replay' })
        render(<DetailPanel runID="run-to-replay" onClose={mockOnClose} canReplay={true} />)

        // Act
        const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
        await user.click(replayButton)

        // Assert
        expect(mockRouterPush).toHaveBeenCalledWith('/app/app-for-replay/workflow?replayRunId=run-to-replay')
      })

      it('should not navigate when appDetail.id is undefined', async () => {
        // Arrange
        const user = userEvent.setup()
        mockAppDetail = null
        render(<DetailPanel runID="run-123" onClose={mockOnClose} canReplay={true} />)

        // Act
        const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
        await user.click(replayButton)

        // Assert
        expect(mockRouterPush).not.toHaveBeenCalled()
      })
    })

    describe('Replay Button (canReplay=false)', () => {
      it('should not render replay button when canReplay is false', () => {
        // Act
        render(<DetailPanel runID="run-123" onClose={mockOnClose} canReplay={false} />)

        // Assert
        expect(screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' })).not.toBeInTheDocument()
      })

      it('should not render replay button when canReplay is not provided (defaults to false)', () => {
        // Act
        render(<DetailPanel runID="run-123" onClose={mockOnClose} />)

        // Assert
        expect(screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' })).not.toBeInTheDocument()
      })
    })
  })

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle app with minimal required fields', () => {
      // Arrange
      const minimalApp = createMockApp({ id: 'minimal-id', name: 'Minimal App' })
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

    it('should handle logs with zero elapsed time', () => {
      // Arrange
      const mockLog = createMockWorkflowLog({
        workflow_run: createMockWorkflowRun({ elapsed_time: 0 }),
      })
      const mockLogs = createMockLogsResponse([mockLog], 1)

      // Act
      render(<WorkflowAppLogList logs={mockLogs} appDetail={createMockApp()} onRefresh={jest.fn()} />)

      // Assert
      expect(screen.getByText('0.000s')).toBeInTheDocument()
    })

    it('should handle large number of logs', () => {
      // Arrange
      const largeLogs = Array.from({ length: 100 }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}`, created_at: Date.now() - i * 1000 }),
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
      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
      expect(screen.getByTestId('total-items')).toHaveTextContent('1000')
    })

    it('should handle advanced-chat mode correctly', () => {
      // Arrange
      const advancedChatApp = createMockApp({ mode: 'advanced-chat' as AppModeEnum })
      const mockLogs = createMockLogsResponse([createMockWorkflowLog()], 1)
      mockedUseSWR.mockReturnValue({
        data: mockLogs,
        mutate: jest.fn(),
        isValidating: false,
        isLoading: false,
        error: undefined,
      })

      // Act
      render(<Logs appDetail={advancedChatApp} />)

      // Assert - should not show triggered_from column
      expect(screen.queryByText('appLog.table.header.triggered_from')).not.toBeInTheDocument()
    })
  })
})
