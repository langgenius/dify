import type { CloudSandboxPlanState } from '../cloud-sandbox-retention'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { APP_PAGE_LIMIT } from '@/config'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import Logs from '../index'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

const mockReplace = vi.fn()
const getChatConversations = vi.fn()
const getCompletionConversations = vi.fn()
const mockPlanState = vi.hoisted(() => ({
  value: 'unrestricted' as CloudSandboxPlanState,
}))

let mockSearchParams = new URLSearchParams()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => '/apps/app-1/logs',
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key),
    toString: () => mockSearchParams.toString(),
  }),
}))

vi.mock('../cloud-sandbox-retention', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cloud-sandbox-retention')>()
  return {
    ...actual,
    useCloudSandboxPlanStatus: () => mockPlanState.value,
  }
})

vi.mock('../list', () => ({
  default: ({ logs }: { logs: { total?: number } }) => (
    <div>
      list-total-
      {logs?.total}
    </div>
  ),
}))

vi.mock('../empty-element', () => ({
  default: () => <div>empty-logs</div>,
}))

vi.mock('../retention-upgrade-notice', () => ({
  RetentionUpgradeNotice: () => <div>retention-upgrade-notice</div>,
}))

vi.mock('@/app/components/base/loading-placeholder', () => ({
  LoadingPlaceholder: () => <div>loading-logs</div>,
}))

describe('Logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    mockPlanState.value = 'unrestricted'
    getChatConversations.mockReturnValue(new Promise(() => {}))
    getCompletionConversations.mockReturnValue(new Promise(() => {}))
  })

  it('should request chat conversations and show a loading state before data arrives', () => {
    render(<Logs appDetail={createAppDetailFixture({ id: 'app-1', mode: 'chat' })} />)

    expect(getChatConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { app_id: 'app-1' },
      }),
    )
    expect(screen.getByRole('heading', { name: /(?:^|\.)title(?=$|:)/ })).toBeInTheDocument()
    expect(screen.getByText(/(?:^|\.)description(?=$|:)/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /(?:^|\.)operation\.learnMore(?=$|:)/ }),
    ).toHaveAttribute('href', 'https://docs.example.com/use-dify/monitor/logs')
    expect(screen.getByText('retention-upgrade-notice')).toBeInTheDocument()
    expect(screen.getByText('loading-logs')).toBeInTheDocument()
  })

  it('should render the empty state for completion apps without logs', async () => {
    getCompletionConversations.mockResolvedValue({
      total: 0,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    render(<Logs appDetail={createAppDetailFixture({ id: 'app-2', mode: 'completion' })} />)

    expect(getCompletionConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { app_id: 'app-2' },
      }),
    )
    expect(await screen.findByText('empty-logs')).toBeInTheDocument()
  })

  it('should update the page query parameter when pagination changes', async () => {
    const user = userEvent.setup()
    getChatConversations.mockResolvedValue({
      total: APP_PAGE_LIMIT + 1,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    render(<Logs appDetail={createAppDetailFixture({ id: 'app-3', mode: 'chat' })} />)

    await user.click(await screen.findByRole('button', { name: 'Go to page 2' }))

    expect(mockReplace).toHaveBeenCalledWith('/apps/app-1/logs?page=2', { scroll: false })
  })

  it('should query the last 30 days when a Sandbox user selects the longest period', async () => {
    const user = userEvent.setup()
    mockPlanState.value = 'sandbox'
    getChatConversations.mockResolvedValue({
      total: 0,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    render(
      <Logs
        appDetail={createAppDetailFixture({
          id: 'app-sandbox-last-30-days',
          mode: 'chat' as const,
        })}
      />,
    )

    await user.click(
      await screen.findByRole('combobox', { name: /appLog\.filter\.period\.last7days/ }),
    )
    await user.click(await screen.findByText(/appLog\.filter\.period\.last30days/))

    expect(
      await screen.findByRole('combobox', { name: /appLog\.filter\.period\.last30days/ }),
    ).toBeInTheDocument()
    expect(getChatConversations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({
          start: dayjs().subtract(30, 'day').startOf('day').format('YYYY-MM-DD HH:mm'),
          end: dayjs().endOf('day').format('YYYY-MM-DD HH:mm'),
        }),
      }),
    )
  })

  it('should use today when a cached period is unavailable to a Sandbox workspace', async () => {
    const user = userEvent.setup()
    const appDetail = createAppDetailFixture({
      id: 'app-period-transition',
      mode: 'chat' as const,
    })
    getChatConversations.mockResolvedValue({
      total: 0,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    const unrestrictedRender = render(<Logs appDetail={appDetail} />)

    await user.click(
      await screen.findByRole('combobox', { name: /appLog\.filter\.period\.last7days/ }),
    )
    await user.click(await screen.findByText(/appLog\.filter\.period\.allTime/))
    expect(getChatConversations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        query: expect.not.objectContaining({
          start: expect.anything(),
          end: expect.anything(),
        }),
      }),
    )
    unrestrictedRender.unmount()

    mockPlanState.value = 'sandbox'
    render(<Logs appDetail={appDetail} />)

    expect(
      await screen.findByRole('combobox', { name: /appLog\.filter\.period\.today/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /common\.operation\.clear appLog\.filter\.period\.today/,
      }),
    ).toBeInTheDocument()
    expect(getChatConversations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({
          start: dayjs().startOf('day').format('YYYY-MM-DD HH:mm'),
          end: expect.any(String),
        }),
      }),
    )
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.chatConversations.get': (input) => getChatConversations(input),
      'apps.byAppId.completionConversations.get': (input) => getCompletionConversations(input),
      'apps.byAppId.annotations.count.get': () => Promise.resolve({ count: 0 }),
    }),
  }
})
