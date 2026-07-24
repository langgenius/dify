/**
 * WorkflowAppLogList Component Tests
 *
 * Tests the workflow log list component which displays:
 * - Table of workflow run logs with sortable columns
 * - Status indicators (success, failed, stopped, running, partial-succeeded)
 * - Trigger display for workflow apps
 * - Drawer with run details
 * - Loading states
 */

import type { WorkflowAppLogDetail, WorkflowLogsResponse, WorkflowRunDetail } from '@/models/log'
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { APP_PAGE_LIMIT } from '@/config'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import WorkflowAppLogList from './list'

// ============================================================================
// Mocks
// ============================================================================

const mockRouterPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

// Mock useTimestamp hook
vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number, _format: string) => `formatted-${timestamp}`,
  }),
}))

// Mock useBreakpoints hook
vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'pc', // Return desktop by default
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

// Mock the Run component
vi.mock('@/app/components/workflow/run', () => ({
  default: ({ runDetailUrl, tracingListUrl }: { runDetailUrl: string, tracingListUrl: string }) => (
    <div data-testid="workflow-run">
      <span data-testid="run-detail-url">{runDetailUrl}</span>
      <span data-testid="tracing-list-url">{tracingListUrl}</span>
    </div>
  ),
}))

// Mock WorkflowContextProvider
vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
}))

// Mock BlockIcon
vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon">BlockIcon</div>,
}))

// Mock useTheme
vi.mock('@/hooks/use-theme', () => ({
  default: () => {
    return { theme: 'light' }
  },
}))

// Mock ahooks
vi.mock('ahooks', () => ({
  useBoolean: (initial: boolean) => {
    const setters = {
      setTrue: vi.fn(),
      setFalse: vi.fn(),
      toggle: vi.fn(),
    }
    return [initial, setters] as const
  },
}))

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

describe('WorkflowAppLogList', () => {
  const defaultOnRefresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ appDetail: createMockApp() })
  })

  // --------------------------------------------------------------------------
  // Rendering Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render loading state when logs are undefined', () => {
      const { container } = render(
        <WorkflowAppLogList logs={undefined} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    })

    it('should render loading state when appDetail is undefined', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])

      const { container } = render(
        <WorkflowAppLogList logs={logs} appDetail={undefined} onRefresh={defaultOnRefresh} />,
      )

      expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    })

    it('should render table when data is available', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render all table headers', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('appLog.table.header.startTime')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.status')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.runtime')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.tokens')).toBeInTheDocument()
      expect(screen.getByText('appLog.table.header.user')).toBeInTheDocument()
    })

    it('should render trigger column for workflow apps', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])
      const workflowApp = createMockApp({ mode: 'workflow' as AppModeEnum })

      render(
        <WorkflowAppLogList logs={logs} appDetail={workflowApp} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('appLog.table.header.triggered_from')).toBeInTheDocument()
    })

    it('should not render trigger column for non-workflow apps', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])
      const chatApp = createMockApp({ mode: 'advanced-chat' as AppModeEnum })

      render(
        <WorkflowAppLogList logs={logs} appDetail={chatApp} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.queryByText('appLog.table.header.triggered_from')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Status Display Tests
  // --------------------------------------------------------------------------
  describe('Status Display', () => {
    it('should render success status correctly', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ status: 'succeeded' }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('Success')).toBeInTheDocument()
    })

    it('should render failure status correctly', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ status: 'failed' }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('Failure')).toBeInTheDocument()
    })

    it('should render stopped status correctly', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ status: 'stopped' }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('Stop')).toBeInTheDocument()
    })

    it('should render running status correctly', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ status: 'running' }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('Running')).toBeInTheDocument()
    })

    it('should render partial-succeeded status correctly', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ status: 'partial-succeeded' as WorkflowRunDetail['status'] }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('Partial Success')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Info Display Tests
  // --------------------------------------------------------------------------
  describe('User Info Display', () => {
    it('should display account name when created by account', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          created_by_account: { id: 'acc-1', name: 'John Doe', email: 'john@example.com' },
          created_by_end_user: undefined,
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should display end user session id when created by end user', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          created_by_end_user: { id: 'user-1', type: 'browser', is_anonymous: false, session_id: 'session-abc-123' },
          created_by_account: undefined,
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('session-abc-123')).toBeInTheDocument()
    })

    it('should display N/A when no user info', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          created_by_account: undefined,
          created_by_end_user: undefined,
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('N/A')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Sorting Tests
  // --------------------------------------------------------------------------
  describe('Sorting', () => {
    it('should sort logs in descending order by default', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({ id: 'log-1', created_at: 1000 }),
        createMockWorkflowLog({ id: 'log-2', created_at: 2000 }),
        createMockWorkflowLog({ id: 'log-3', created_at: 3000 }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const rows = screen.getAllByRole('row')
      // First row is header, data rows start from index 1
      // In descending order, newest (3000) should be first
      expect(rows.length).toBe(4) // 1 header + 3 data rows
    })

    it('should toggle sort order when clicking on start time header', async () => {
      const user = userEvent.setup()
      const logs = createMockLogsResponse([
        createMockWorkflowLog({ id: 'log-1', created_at: 1000 }),
        createMockWorkflowLog({ id: 'log-2', created_at: 2000 }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      // Click on the start time header to toggle sort
      const startTimeHeader = screen.getByText('appLog.table.header.startTime')
      await user.click(startTimeHeader)

      // Arrow should rotate (indicated by class change)
      // The sort icon should have rotate-180 class for ascending
      const sortIcon = startTimeHeader.closest('div')?.querySelector('svg')
      expect(sortIcon).toBeInTheDocument()
    })

    it('should render sort arrow icon', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])

      const { container } = render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      // Check for ArrowDownIcon presence
      const sortArrow = container.querySelector('svg.ml-0\\.5')
      expect(sortArrow).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Drawer Tests
  // --------------------------------------------------------------------------
  describe('Drawer', () => {
    it('should open drawer when clicking on a log row', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ appDetail: createMockApp({ id: 'app-123' }) })
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          id: 'log-1',
          workflow_run: createMockWorkflowRun({ id: 'run-456' }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const dataRows = screen.getAllByRole('row')
      await user.click(dataRows[1]) // Click first data row

      const dialog = await screen.findByRole('dialog')
      expect(dialog).toBeInTheDocument()
      expect(screen.getByText('appLog.runDetail.workflowTitle')).toBeInTheDocument()
    })

    it('should close drawer and call onRefresh when closing', async () => {
      const user = userEvent.setup()
      const onRefresh = vi.fn()
      useAppStore.setState({ appDetail: createMockApp() })
      const logs = createMockLogsResponse([createMockWorkflowLog()])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={onRefresh} />,
      )

      // Open drawer
      const dataRows = screen.getAllByRole('row')
      await user.click(dataRows[1])
      await screen.findByRole('dialog')

      // Close drawer using Escape key
      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(onRefresh).toHaveBeenCalled()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('should highlight selected row', async () => {
      const user = userEvent.setup()
      const logs = createMockLogsResponse([createMockWorkflowLog()])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const dataRows = screen.getAllByRole('row')
      const dataRow = dataRows[1]

      // Before click - no highlight
      expect(dataRow).not.toHaveClass('bg-background-default-hover')

      // After click - has highlight (via currentLog state)
      await user.click(dataRow)

      // The row should have the selected class
      expect(dataRow).toHaveClass('bg-background-default-hover')
    })
  })

  // --------------------------------------------------------------------------
  // Replay Functionality Tests
  // --------------------------------------------------------------------------
  describe('Replay Functionality', () => {
    it('should allow replay when triggered from app-run', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ appDetail: createMockApp({ id: 'app-replay' }) })
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({
            id: 'run-to-replay',
            triggered_from: WorkflowRunTriggeredFrom.APP_RUN,
          }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      // Open drawer
      const dataRows = screen.getAllByRole('row')
      await user.click(dataRows[1])
      await screen.findByRole('dialog')

      // Replay button should be present for app-run triggers
      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      await user.click(replayButton)

      expect(mockRouterPush).toHaveBeenCalledWith('/app/app-replay/workflow?replayRunId=run-to-replay')
    })

    it('should allow replay when triggered from debugging', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ appDetail: createMockApp({ id: 'app-debug' }) })
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({
            id: 'debug-run',
            triggered_from: WorkflowRunTriggeredFrom.DEBUGGING,
          }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      // Open drawer
      const dataRows = screen.getAllByRole('row')
      await user.click(dataRows[1])
      await screen.findByRole('dialog')

      // Replay button should be present for debugging triggers
      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      expect(replayButton).toBeInTheDocument()
    })

    it('should not show replay for webhook triggers', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ appDetail: createMockApp({ id: 'app-webhook' }) })
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({
            id: 'webhook-run',
            triggered_from: WorkflowRunTriggeredFrom.WEBHOOK,
          }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      // Open drawer
      const dataRows = screen.getAllByRole('row')
      await user.click(dataRows[1])
      await screen.findByRole('dialog')

      // Replay button should not be present for webhook triggers
      expect(screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' })).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Unread Indicator Tests
  // --------------------------------------------------------------------------
  describe('Unread Indicator', () => {
    it('should show unread indicator for unread logs', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          read_at: undefined,
        }),
      ])

      const { container } = render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      // Unread indicator is a small blue dot
      const unreadDot = container.querySelector('.bg-util-colors-blue-blue-500')
      expect(unreadDot).toBeInTheDocument()
    })

    it('should not show unread indicator for read logs', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          read_at: Date.now(),
        }),
      ])

      const { container } = render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      // No unread indicator
      const unreadDot = container.querySelector('.bg-util-colors-blue-blue-500')
      expect(unreadDot).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Runtime Display Tests
  // --------------------------------------------------------------------------
  describe('Runtime Display', () => {
    it('should display elapsed time with 3 decimal places', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ elapsed_time: 1.23456 }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('1.235s')).toBeInTheDocument()
    })

    it('should display 0 elapsed time with special styling', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ elapsed_time: 0 }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const zeroTime = screen.getByText('0.000s')
      expect(zeroTime).toBeInTheDocument()
      expect(zeroTime).toHaveClass('text-text-quaternary')
    })
  })

  // --------------------------------------------------------------------------
  // Token Display Tests
  // --------------------------------------------------------------------------
  describe('Token Display', () => {
    it('should display total tokens', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ total_tokens: 12345 }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('12345')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Empty State Tests
  // --------------------------------------------------------------------------
  describe('Empty State', () => {
    it('should render empty table when logs data is empty', () => {
      const logs = createMockLogsResponse([])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const table = screen.getByRole('table')
      expect(table).toBeInTheDocument()

      // Should only have header row
      const rows = screen.getAllByRole('row')
      expect(rows).toHaveLength(1)
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle multiple logs correctly', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({ id: 'log-1', created_at: 1000 }),
        createMockWorkflowLog({ id: 'log-2', created_at: 2000 }),
        createMockWorkflowLog({ id: 'log-3', created_at: 3000 }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const rows = screen.getAllByRole('row')
      expect(rows).toHaveLength(4) // 1 header + 3 data rows
    })

    it('should handle logs with missing workflow_run data gracefully', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({
            elapsed_time: 0,
            total_tokens: 0,
          }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('0.000s')).toBeInTheDocument()
      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should handle null workflow_run.triggered_from for non-workflow apps', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({
            triggered_from: undefined as any,
          }),
        }),
      ])
      const chatApp = createMockApp({ mode: 'advanced-chat' as AppModeEnum })

      render(
        <WorkflowAppLogList logs={logs} appDetail={chatApp} onRefresh={defaultOnRefresh} />,
      )

      // Should render without trigger column
      expect(screen.queryByText('appLog.table.header.triggered_from')).not.toBeInTheDocument()
    })
  })
})
