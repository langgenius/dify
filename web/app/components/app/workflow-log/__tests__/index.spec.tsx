import type {
  AppDetailWithSite,
  AppMode,
  GetAppsByAppIdWorkflowAppLogsData,
  WorkflowAppLogPaginationResponse,
  WorkflowAppLogPartialResponse,
  WorkflowRunForLogResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { CloudSandboxPlanState } from '../../log/cloud-sandbox-retention'
import type { ILogsProps } from '../index'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { APP_PAGE_LIMIT } from '@/config'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Logs from '../index'

const mockPlanState = vi.hoisted(() => ({
  value: 'unrestricted' as CloudSandboxPlanState,
}))

type WorkflowLogsInput = {
  params: { app_id: string }
  query?: GetAppsByAppIdWorkflowAppLogsData['query']
}

const mockedUseWorkflowLogs =
  vi.fn<(input: WorkflowLogsInput) => Promise<WorkflowAppLogPaginationResponse>>()

vi.mock('../../log/cloud-sandbox-retention', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../log/cloud-sandbox-retention')>()
  return {
    ...actual,
    useCloudSandboxPlanStatus: () => mockPlanState.value,
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('../../log/retention-upgrade-notice', () => ({
  RetentionUpgradeNotice: () => <div>retention-upgrade-notice</div>,
}))

// Mock the Run component to avoid complex dependencies
vi.mock('@/app/components/workflow/run', () => ({
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

vi.mock('@/hooks/use-theme', () => ({
  default: () => {
    return { theme: 'light' }
  },
}))

const renderWithQueryClient = (ui: React.ReactElement) => {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper()
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryWrapper>
      <NuqsWrapper>{children}</NuqsWrapper>
    </QueryWrapper>
  )

  return render(ui, { wrapper })
}

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
  overrides: Partial<WorkflowAppLogPartialResponse> = {},
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

const getMockCallParams = () => {
  const input = mockedUseWorkflowLogs.mock.calls.at(-1)?.[0]
  return input && { appId: input.params.app_id, params: input.query }
}

describe('Logs Container', () => {
  const defaultProps: ILogsProps = {
    appDetail: createMockApp(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPlanState.value = 'unrestricted'
  })

  describe('Loading State', () => {
    it('should show loading spinner when data is undefined', async () => {
      mockedUseWorkflowLogs.mockReturnValue(new Promise(() => {}))

      const { container } = renderWithQueryClient(<Logs {...defaultProps} />)

      expect(within(container).queryByRole('progressbar')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should render empty element when total is 0', async () => {
      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse([], 0))

      renderWithQueryClient(<Logs {...defaultProps} />)

      expect(await screen.findByText('appLog.table.empty.element.title')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })

  describe('Data Fetching', () => {
    it('should call useWorkflowLogs with correct appId and default params', async () => {
      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse([], 0))

      renderWithQueryClient(<Logs {...defaultProps} />)

      await waitFor(() => expect(mockedUseWorkflowLogs).toHaveBeenCalled())
      const callArg = getMockCallParams()
      expect(callArg?.params).toHaveProperty('created_at__after')
      expect(callArg?.params).toHaveProperty('created_at__before')
      expect(callArg?.params).not.toHaveProperty('status')
      expect(callArg).toMatchObject({
        appId: defaultProps.appDetail.id,
        params: expect.objectContaining({
          page: 1,
          detail: true,
          limit: APP_PAGE_LIMIT,
        }),
      })
    })
  })

  describe('Filter Integration', () => {
    it('should update query when selecting status filter', async () => {
      const user = userEvent.setup()
      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse([], 0))

      renderWithQueryClient(<Logs {...defaultProps} />)

      await user.click(screen.getByText('appLog.status.all'))
      await user.click(await screen.findByText('appLog.status.succeeded'))

      await waitFor(() => {
        const lastCall = getMockCallParams()
        expect(lastCall?.params).toMatchObject({
          status: 'succeeded',
        })
      })
    })

    it('should update query when selecting period filter', async () => {
      const user = userEvent.setup()
      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse([], 0))

      renderWithQueryClient(<Logs {...defaultProps} />)

      await user.click(screen.getByText('appLog.filter.period.last7days'))
      await user.click(await screen.findByText('appLog.filter.period.allTime'))

      await waitFor(() => {
        const lastCall = getMockCallParams()
        expect(lastCall?.params).not.toHaveProperty('created_at__after')
        expect(lastCall?.params).not.toHaveProperty('created_at__before')
      })
    })

    it('should query the last 30 days when a Sandbox user selects the longest period', async () => {
      const user = userEvent.setup()
      mockPlanState.value = 'sandbox'
      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse([], 0))

      renderWithQueryClient(<Logs {...defaultProps} />)

      await user.click(screen.getByText('appLog.filter.period.last7days'))
      await user.click(await screen.findByText('appLog.filter.period.last30days'))

      expect(
        screen.getByRole('combobox', { name: 'appLog.filter.period.last30days' }),
      ).toBeInTheDocument()
      const params = getMockCallParams()?.params
      expect(
        dayjs(String(params?.created_at__before)).diff(String(params?.created_at__after), 'day'),
      ).toBe(30)
    })

    it('should update query when typing keyword', async () => {
      const user = userEvent.setup()
      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse([], 0))

      renderWithQueryClient(<Logs {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('common.operation.search')
      await user.type(searchInput, 'test-keyword')

      await waitFor(() => {
        const lastCall = getMockCallParams()
        expect(lastCall?.params).toMatchObject({
          keyword: 'test-keyword',
        })
      })
    })
  })

  describe('Pagination', () => {
    it('should not render pagination when total is less than limit', async () => {
      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse([createMockWorkflowLog()], 1))

      renderWithQueryClient(<Logs {...defaultProps} />)

      await screen.findByRole('table')
      expect(
        screen.queryByRole('button', { name: 'common.pagination.next' }),
      ).not.toBeInTheDocument()
    })

    it('should request the selected page when total exceeds the page size', async () => {
      const user = userEvent.setup()

      const logs = Array.from({ length: APP_PAGE_LIMIT }, (_, i) =>
        createMockWorkflowLog({ id: `log-${i}` }),
      )

      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse(logs, APP_PAGE_LIMIT + 10))

      renderWithQueryClient(<Logs {...defaultProps} />)

      await screen.findByRole('table')
      await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
      await waitFor(() => expect(getMockCallParams()?.params?.page).toBe(2))
    })
  })

  describe('List Rendering', () => {
    it('should display log data in table', async () => {
      mockedUseWorkflowLogs.mockResolvedValue(
        createMockLogsResponse(
          [
            createMockWorkflowLog({
              workflow_run: createMockWorkflowRun({
                status: 'succeeded',
                total_tokens: 500,
              }),
            }),
          ],
          1,
        ),
      )

      renderWithQueryClient(<Logs {...defaultProps} />)

      expect(await screen.findByText('appLog.status.succeeded')).toBeInTheDocument()
      expect(await screen.findByText('500')).toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle different app modes', async () => {
      mockedUseWorkflowLogs.mockResolvedValue(createMockLogsResponse([createMockWorkflowLog()], 1))

      const chatApp = createMockApp({ mode: 'advanced-chat' as AppMode })

      renderWithQueryClient(<Logs appDetail={chatApp} />)

      await screen.findByRole('table')
      expect(screen.queryByText('appLog.table.header.triggered_from')).not.toBeInTheDocument()
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflowAppLogs.get': (input) => mockedUseWorkflowLogs(input),
    }),
  }
})
