import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useParams } from 'next/navigation'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import { useInfiniteAppList } from '@/service/use-apps'
import { AppModeEnum } from '@/types/app'
import AppNav from './index'

vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: vi.fn(),
}))

vi.mock('@/service/use-apps', () => ({
  useInfiniteAppList: vi.fn(),
}))

vi.mock('@/app/components/app/create-app-dialog', () => ({
  default: ({ show, onClose, onSuccess }: { show: boolean, onClose: () => void, onSuccess: () => void }) =>
    show
      ? (
          <button
            type="button"
            data-testid="create-app-template-dialog"
            onClick={() => {
              onClose()
              onSuccess()
            }}
          >
            Create Template
          </button>
        )
      : null,
}))

vi.mock('@/app/components/app/create-app-modal', () => ({
  default: ({ show, onClose, onSuccess }: { show: boolean, onClose: () => void, onSuccess: () => void }) =>
    show
      ? (
          <button
            type="button"
            data-testid="create-app-modal"
            onClick={() => {
              onClose()
              onSuccess()
            }}
          >
            Create App
          </button>
        )
      : null,
}))

vi.mock('@/app/components/app/create-from-dsl-modal', () => ({
  default: ({ show, onClose, onSuccess }: { show: boolean, onClose: () => void, onSuccess: () => void }) =>
    show
      ? (
          <button
            type="button"
            data-testid="create-from-dsl-modal"
            onClick={() => {
              onClose()
              onSuccess()
            }}
          >
            Create from DSL
          </button>
        )
      : null,
}))

vi.mock('../nav', () => ({
  default: ({
    onCreate,
    onLoadMore,
    navigationItems,
  }: {
    onCreate: (state: string) => void
    onLoadMore?: () => void
    navigationItems?: Array<{ id: string, name: string, link: string }>
  }) => (
    <div data-testid="nav">
      <ul data-testid="nav-items">
        {(navigationItems ?? []).map(item => (
          <li key={item.id}>{`${item.name} -> ${item.link}`}</li>
        ))}
      </ul>
      <button type="button" onClick={() => onCreate('blank')} data-testid="create-blank">
        Create Blank
      </button>
      <button type="button" onClick={() => onCreate('template')} data-testid="create-template">
        Create Template
      </button>
      <button type="button" onClick={() => onCreate('dsl')} data-testid="create-dsl">
        Create DSL
      </button>
      <button type="button" onClick={onLoadMore} data-testid="load-more">
        Load More
      </button>
    </div>
  ),
}))

const mockAppData = [
  {
    id: 'app-1',
    name: 'App 1',
    mode: AppModeEnum.AGENT_CHAT,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: null,
    icon_url: null,
  },
]

const mockUseParams = vi.mocked(useParams)
const mockUseAppContext = vi.mocked(useAppContext)
const mockUseAppStore = vi.mocked(useAppStore)
const mockUseInfiniteAppList = vi.mocked(useInfiniteAppList)
let mockAppDetail: { id: string, name: string } | null = null

const setupDefaultMocks = (options?: {
  hasNextPage?: boolean
  refetch?: () => void
  fetchNextPage?: () => void
  isEditor?: boolean
  appData?: typeof mockAppData
}) => {
  const refetch = options?.refetch ?? vi.fn()
  const fetchNextPage = options?.fetchNextPage ?? vi.fn()

  mockUseParams.mockReturnValue({ appId: 'app-1' } as ReturnType<typeof useParams>)
  mockUseAppContext.mockReturnValue({ isCurrentWorkspaceEditor: options?.isEditor ?? false } as ReturnType<typeof useAppContext>)
  mockUseAppStore.mockImplementation((selector: unknown) => (selector as (state: { appDetail: { id: string, name: string } | null }) => unknown)({ appDetail: mockAppDetail }))
  mockUseInfiniteAppList.mockReturnValue({
    data: { pages: [{ data: options?.appData ?? mockAppData }] },
    fetchNextPage,
    hasNextPage: options?.hasNextPage ?? false,
    isFetchingNextPage: false,
    refetch,
  } as ReturnType<typeof useInfiniteAppList>)

  return { refetch, fetchNextPage }
}

describe('AppNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetail = null
    setupDefaultMocks()
  })

  it('should build editor links and update app name when app detail changes', async () => {
    setupDefaultMocks({
      isEditor: true,
      appData: [
        {
          id: 'app-1',
          name: 'App 1',
          mode: AppModeEnum.AGENT_CHAT,
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: null,
          icon_url: null,
        },
        {
          id: 'app-2',
          name: 'App 2',
          mode: AppModeEnum.WORKFLOW,
          icon_type: 'emoji',
          icon: '⚙️',
          icon_background: null,
          icon_url: null,
        },
      ],
    })

    const { rerender } = render(<AppNav />)

    expect(screen.getByText('App 1 -> /app/app-1/configuration')).toBeInTheDocument()
    expect(screen.getByText('App 2 -> /app/app-2/workflow')).toBeInTheDocument()

    mockAppDetail = { id: 'app-1', name: 'Updated App Name' }
    rerender(<AppNav />)

    await waitFor(() => {
      expect(screen.getByText('Updated App Name -> /app/app-1/configuration')).toBeInTheDocument()
    })
  })

  it('should open and close create app modal, then refetch', async () => {
    const user = userEvent.setup()
    const { refetch } = setupDefaultMocks()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-blank'))
    expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('create-app-modal'))
    await waitFor(() => {
      expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      expect(refetch).toHaveBeenCalledTimes(1)
    })
  })

  it('should open and close template modal, then refetch', async () => {
    const user = userEvent.setup()
    const { refetch } = setupDefaultMocks()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-template'))
    expect(screen.getByTestId('create-app-template-dialog')).toBeInTheDocument()

    await user.click(screen.getByTestId('create-app-template-dialog'))
    await waitFor(() => {
      expect(screen.queryByTestId('create-app-template-dialog')).not.toBeInTheDocument()
      expect(refetch).toHaveBeenCalledTimes(1)
    })
  })

  it('should open and close DSL modal, then refetch', async () => {
    const user = userEvent.setup()
    const { refetch } = setupDefaultMocks()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-dsl'))
    expect(screen.getByTestId('create-from-dsl-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('create-from-dsl-modal'))
    await waitFor(() => {
      expect(screen.queryByTestId('create-from-dsl-modal')).not.toBeInTheDocument()
      expect(refetch).toHaveBeenCalledTimes(1)
    })
  })

  it('should load more when user clicks load more and more data is available', async () => {
    const user = userEvent.setup()
    const { fetchNextPage } = setupDefaultMocks({ hasNextPage: true })
    render(<AppNav />)

    await user.click(screen.getByTestId('load-more'))
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('should not load more when user clicks load more and no data is available', async () => {
    const user = userEvent.setup()
    const { fetchNextPage } = setupDefaultMocks({ hasNextPage: false })
    render(<AppNav />)

    await user.click(screen.getByTestId('load-more'))
    expect(fetchNextPage).not.toHaveBeenCalled()
  })
})
