/* oxlint-disable typescript/no-explicit-any */
import type { CloudSandboxPlanState } from '../cloud-sandbox-retention'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { APP_PAGE_LIMIT } from '@/config'
import { AppModeEnum } from '@/types/app'
import Logs from '../index'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

const mockReplace = vi.fn()
const mockUseChatConversations = vi.fn()
const mockUseCompletionConversations = vi.fn()
const mockPlanState = vi.hoisted(() => ({
  value: 'unrestricted' as CloudSandboxPlanState,
}))

let mockSearchParams = new URLSearchParams()
vi.mock('ahooks', async () => {
  return {
    useDebounce: <T,>(value: T) => value,
  }
})

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

vi.mock('@/service/use-log', () => ({
  useChatConversations: (...args: unknown[]) => mockUseChatConversations(...args),
  useCompletionConversations: (...args: unknown[]) => mockUseCompletionConversations(...args),
  useAnnotationsCount: () => ({
    data: { count: 0 },
    isLoading: false,
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

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div>loading-logs</div>,
}))

describe('Logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    mockPlanState.value = 'unrestricted'
    mockUseChatConversations.mockReturnValue({
      data: undefined,
      refetch: vi.fn(),
    })
    mockUseCompletionConversations.mockReturnValue({
      data: undefined,
      refetch: vi.fn(),
    })
  })

  it('should request chat conversations and show a loading state before data arrives', () => {
    render(
      <Logs
        appDetail={
          {
            id: 'app-1',
            mode: AppModeEnum.CHAT,
          } as any
        }
      />,
    )

    expect(mockUseChatConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app-1',
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

  it('should render the empty state for completion apps without logs', () => {
    mockUseCompletionConversations.mockReturnValue({
      data: { total: 0 },
      refetch: vi.fn(),
    })

    render(
      <Logs
        appDetail={
          {
            id: 'app-2',
            mode: AppModeEnum.COMPLETION,
          } as any
        }
      />,
    )

    expect(mockUseCompletionConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app-2',
      }),
    )
    expect(screen.getByText('empty-logs')).toBeInTheDocument()
  })

  it('should update the page query parameter when pagination changes', () => {
    mockUseChatConversations.mockReturnValue({
      data: { total: APP_PAGE_LIMIT + 1 },
      refetch: vi.fn(),
    })

    render(
      <Logs
        appDetail={
          {
            id: 'app-3',
            mode: AppModeEnum.CHAT,
          } as any
        }
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }))

    expect(mockReplace).toHaveBeenCalledWith('/apps/app-1/logs?page=2', { scroll: false })
  })

  it('should query the last 30 days when a Sandbox user selects the longest period', async () => {
    const user = userEvent.setup()
    mockPlanState.value = 'sandbox'
    mockUseChatConversations.mockReturnValue({
      data: { total: 0 },
      refetch: vi.fn(),
    })

    render(
      <Logs
        appDetail={
          {
            id: 'app-sandbox-last-30-days',
            mode: AppModeEnum.CHAT,
          } as any
        }
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /appLog\.filter\.period\.last7days/ }))
    await user.click(await screen.findByText(/appLog\.filter\.period\.last30days/))

    expect(
      screen.getByRole('combobox', { name: /appLog\.filter\.period\.last30days/ }),
    ).toBeInTheDocument()
    expect(mockUseChatConversations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({
          start: dayjs().subtract(30, 'day').startOf('day').format('YYYY-MM-DD HH:mm'),
          end: dayjs().endOf('day').format('YYYY-MM-DD HH:mm'),
        }),
      }),
    )
  })

  it('should use today when a cached period is unavailable to a Sandbox workspace', async () => {
    const user = userEvent.setup()
    const appDetail = {
      id: 'app-period-transition',
      mode: AppModeEnum.CHAT,
    } as any
    mockUseChatConversations.mockReturnValue({
      data: { total: 0 },
      refetch: vi.fn(),
    })

    const unrestrictedRender = render(<Logs appDetail={appDetail} />)

    await user.click(screen.getByRole('combobox', { name: /appLog\.filter\.period\.last7days/ }))
    await user.click(await screen.findByText(/appLog\.filter\.period\.allTime/))
    expect(mockUseChatConversations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        params: expect.not.objectContaining({
          start: expect.anything(),
          end: expect.anything(),
        }),
      }),
    )
    unrestrictedRender.unmount()

    mockPlanState.value = 'sandbox'
    render(<Logs appDetail={appDetail} />)

    expect(
      screen.getByRole('combobox', { name: /appLog\.filter\.period\.today/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /common\.operation\.clear appLog\.filter\.period\.today/,
      }),
    ).toBeInTheDocument()
    expect(mockUseChatConversations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({
          start: dayjs().startOf('day').format('YYYY-MM-DD HH:mm'),
          end: expect.any(String),
        }),
      }),
    )
  })
})
