/* eslint-disable ts/no-explicit-any */
import { fireEvent, render, screen } from '@testing-library/react'
import { APP_PAGE_LIMIT } from '@/config'
import { AppModeEnum } from '@/types/app'
import Logs from '../index'

const mockReplace = vi.fn()
const mockUseChatConversations = vi.fn()
const mockUseCompletionConversations = vi.fn()

let mockSearchParams = new URLSearchParams()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

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
}))

vi.mock('../filter', () => ({
  TIME_PERIOD_MAPPING: {
    2: { value: 7 },
    9: { value: 0 },
  },
  default: ({ setQueryParams }: { setQueryParams: (next: Record<string, string>) => void }) => (
    <button onClick={() => setQueryParams({ period: '9', annotation_status: 'all', sort_by: '-created_at', keyword: 'hello' })}>
      filter-controls
    </button>
  ),
}))

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

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div>loading-logs</div>,
}))

vi.mock('@/app/components/base/pagination', () => ({
  default: ({ onChange }: { onChange: (page: number) => void }) => (
    <button onClick={() => onChange(1)}>go-to-page-2</button>
  ),
}))

describe('Logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
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
        appDetail={{
          id: 'app-1',
          mode: AppModeEnum.CHAT,
        } as any}
      />,
    )

    expect(mockUseChatConversations).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-1',
    }))
    expect(screen.getByText('loading-logs')).toBeInTheDocument()
  })

  it('should render the empty state for completion apps without logs', () => {
    mockUseCompletionConversations.mockReturnValue({
      data: { total: 0 },
      refetch: vi.fn(),
    })

    render(
      <Logs
        appDetail={{
          id: 'app-2',
          mode: AppModeEnum.COMPLETION,
        } as any}
      />,
    )

    expect(mockUseCompletionConversations).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-2',
    }))
    expect(screen.getByText('empty-logs')).toBeInTheDocument()
  })

  it('should update the page query parameter when pagination changes', () => {
    mockUseChatConversations.mockReturnValue({
      data: { total: APP_PAGE_LIMIT + 1 },
      refetch: vi.fn(),
    })

    render(
      <Logs
        appDetail={{
          id: 'app-3',
          mode: AppModeEnum.CHAT,
        } as any}
      />,
    )

    fireEvent.click(screen.getByText('go-to-page-2'))

    expect(mockReplace).toHaveBeenCalledWith('/apps/app-1/logs?page=2', { scroll: false })
  })
})
