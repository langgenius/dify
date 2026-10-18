import type {
  AppDetailWithSite,
  AppMode,
  WorkflowAppLogPaginationResponse,
  WorkflowAppLogPartialResponse,
  WorkflowRunForLogResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { APP_PAGE_LIMIT } from '@/config'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import WorkflowAppLogList from '../list'

const mockRouterPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number, _format: string) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'pc', // Return desktop by default
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

vi.mock('@/app/components/workflow/run', () => ({
  default: ({ runDetailUrl, tracingListUrl }: { runDetailUrl: string; tracingListUrl: string }) => (
    <div data-testid="workflow-run">
      <span data-testid="run-detail-url">{runDetailUrl}</span>
      <span data-testid="tracing-list-url">{tracingListUrl}</span>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon">BlockIcon</div>,
}))

const createMockApp = (overrides: Partial<AppDetailWithSite> = {}): AppDetailWithSite =>
  createAppDetailFixture({
    id: 'test-app-id',
    name: 'Test App',
    mode: 'workflow',
    site: createAppSiteFixture({ access_token: 'token', app_base_url: 'https://example.com' }),
    ...overrides,
  })

const createMockWorkflowRun = (
  overrides: Partial<WorkflowRunForLogResponse> = {},
): WorkflowRunForLogResponse => ({
  id: 'run-1',
  version: '1.0.0',
  status: 'succeeded',
  elapsed_time: 1.234,
  total_tokens: 100,
  total_steps: 5,
  finished_at: Date.now(),
  triggered_from: WorkflowRunTriggeredFrom.APP_RUN,
  ...overrides,
})

const createMockWorkflowLog = (
  overrides: Partial<WorkflowAppLogPartialResponse> & { read_at?: number } = {},
): WorkflowAppLogPartialResponse => ({
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
  data: WorkflowAppLogPartialResponse[] = [],
  total = data.length,
): WorkflowAppLogPaginationResponse => ({
  data,
  has_more: data.length < total,
  limit: APP_PAGE_LIMIT,
  total,
  page: 1,
})

describe('WorkflowAppLogList', () => {
  const defaultOnRefresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render loading state when logs are undefined', () => {
      const { container } = render(
        <WorkflowAppLogList
          logs={undefined}
          appDetail={createMockApp()}
          onRefresh={defaultOnRefresh}
        />,
      )

      expect(within(container).getByRole('progressbar')).toBeInTheDocument()
    })

    it('should render loading state when appDetail is undefined', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])

      const { container } = render(
        <WorkflowAppLogList logs={logs} appDetail={undefined} onRefresh={defaultOnRefresh} />,
      )

      expect(within(container).getByRole('progressbar')).toBeInTheDocument()
    })

    it('should render trigger column for workflow apps', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])
      const workflowApp = createMockApp({ mode: 'workflow' as AppMode })

      render(
        <WorkflowAppLogList logs={logs} appDetail={workflowApp} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('appLog.table.header.triggered_from'))!.toBeInTheDocument()
    })

    it('should not render trigger column for non-workflow apps', () => {
      const logs = createMockLogsResponse([createMockWorkflowLog()])
      const chatApp = createMockApp({ mode: 'advanced-chat' as AppMode })

      render(<WorkflowAppLogList logs={logs} appDetail={chatApp} onRefresh={defaultOnRefresh} />)

      expect(screen.queryByText('appLog.table.header.triggered_from')).not.toBeInTheDocument()
    })
  })

  it.each([
    'succeeded',
    'failed',
    'stopped',
    'running',
    'paused',
    'scheduled',
    'partial-succeeded',
  ])('displays the server run status %s', (status) => {
    render(
      <WorkflowAppLogList
        logs={createMockLogsResponse([
          createMockWorkflowLog({ workflow_run: createMockWorkflowRun({ status }) }),
        ])}
        appDetail={createMockApp()}
        onRefresh={defaultOnRefresh}
      />,
    )
    expect(screen.getByRole('cell', { name: `appLog.status.${status}` })).toBeVisible()
  })

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

      expect(screen.getByText('John Doe'))!.toBeInTheDocument()
    })

    it('should display end user session id when created by end user', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          created_by_end_user: {
            id: 'user-1',
            type: 'browser',
            is_anonymous: false,
            session_id: 'session-abc-123',
          },
          created_by_account: undefined,
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      expect(screen.getByText('session-abc-123'))!.toBeInTheDocument()
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

      expect(screen.getByText('N/A'))!.toBeInTheDocument()
    })
  })

  describe('Sorting', () => {
    it('should toggle sort order when clicking on start time header', async () => {
      const user = userEvent.setup()
      const logs = createMockLogsResponse([
        createMockWorkflowLog({ id: 'log-1', created_at: 1000 }),
        createMockWorkflowLog({ id: 'log-2', created_at: 2000 }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const startTimeHeader = screen.getByRole('columnheader', {
        name: 'appLog.table.header.startTime',
      })
      const sortButton = screen.getByRole('button', { name: 'appLog.table.header.startTime' })
      const timestamps = () =>
        screen
          .getAllByRole('row')
          .slice(1)
          .map((row) => within(row).getByRole('button').textContent)
      expect(timestamps()).toEqual(['formatted-2000', 'formatted-1000'])
      expect(startTimeHeader).toHaveAttribute('aria-sort', 'descending')
      sortButton.focus()
      await user.keyboard('{Enter}')
      expect(startTimeHeader).toHaveAttribute('aria-sort', 'ascending')
      expect(timestamps()).toEqual(['formatted-1000', 'formatted-2000'])
      await user.keyboard(' ')
      expect(startTimeHeader).toHaveAttribute('aria-sort', 'descending')
      expect(timestamps()).toEqual(['formatted-2000', 'formatted-1000'])
    })
  })

  describe('Drawer', () => {
    it.each(['keyboard', 'row'])(
      'restores focus to the selected log after %s opening and refresh',
      async (opening) => {
        const user = userEvent.setup()
        const appDetail = createMockApp()
        const onRefresh = vi.fn()

        const logs = createMockLogsResponse([
          createMockWorkflowLog({ id: 'log-1', created_at: 100 }),
          createMockWorkflowLog({ id: 'log-2', created_at: 200 }),
        ])
        const { rerender } = render(
          <WorkflowAppLogList logs={logs} appDetail={appDetail} onRefresh={onRefresh} />,
        )
        const trigger = screen.getByRole('button', { name: 'formatted-100' })
        if (opening === 'keyboard') {
          trigger.focus()
          await user.keyboard('{Enter}')
        } else {
          await user.click(screen.getAllByRole('row')[2]!)
        }
        await screen.findByRole('dialog')
        rerender(
          <WorkflowAppLogList
            logs={createMockLogsResponse(logs.data.map((log) => ({ ...log, read_at: 300 })))}
            appDetail={appDetail}
            onRefresh={onRefresh}
          />,
        )
        await user.keyboard('{Escape}')
        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
          expect(trigger).toHaveFocus()
        })
        expect(onRefresh).toHaveBeenCalledTimes(1)
      },
    )
  })

  describe('Replay Functionality', () => {
    it('should allow replay when triggered from app-run', async () => {
      const user = userEvent.setup()

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

      const dataRows = screen.getAllByRole('row')
      await user.click(dataRows[1]!)
      await screen.findByRole('dialog')

      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      await user.click(replayButton)

      expect(mockRouterPush).toHaveBeenCalledWith(
        '/app/test-app-id/workflow?replayRunId=run-to-replay',
      )
    })

    it('should allow replay when triggered from debugging', async () => {
      const user = userEvent.setup()

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

      const dataRows = screen.getAllByRole('row')
      await user.click(dataRows[1]!)
      await screen.findByRole('dialog')

      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      await user.click(replayButton)
      expect(mockRouterPush).toHaveBeenCalledWith('/app/test-app-id/workflow?replayRunId=debug-run')
    })

    it('should not show replay for webhook triggers', async () => {
      const user = userEvent.setup()

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

      const dataRows = screen.getAllByRole('row')
      await user.click(dataRows[1]!)
      await screen.findByRole('dialog')

      expect(
        screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' }),
      ).not.toBeInTheDocument()
    })
  })

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

      expect(screen.getByText('1.235s'))!.toBeInTheDocument()
    })

    it('displays zero duration without treating it as missing', () => {
      const logs = createMockLogsResponse([
        createMockWorkflowLog({
          workflow_run: createMockWorkflowRun({ elapsed_time: 0 }),
        }),
      ])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const zeroTime = screen.getByText('0.000s')
      expect(zeroTime)!.toBeInTheDocument()
    })
  })

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

      expect(screen.getByText('12345'))!.toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should render empty table when logs data is empty', () => {
      const logs = createMockLogsResponse([])

      render(
        <WorkflowAppLogList logs={logs} appDetail={createMockApp()} onRefresh={defaultOnRefresh} />,
      )

      const table = screen.getByRole('table')
      expect(table)!.toBeInTheDocument()

      const rows = screen.getAllByRole('row')
      expect(rows).toHaveLength(1)
    })
  })
})
