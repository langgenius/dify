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
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
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
          <div
            data-testid="create-app-template-dialog"
            onClick={() => {
              onClose()
              onSuccess()
            }}
          >
            Create Template
          </div>
        )
      : null,
}))

vi.mock('@/app/components/app/create-app-modal', () => ({
  default: ({ show, onClose, onSuccess }: { show: boolean, onClose: () => void, onSuccess: () => void }) =>
    show
      ? (
          <div
            data-testid="create-app-modal"
            onClick={() => {
              onClose()
              onSuccess()
            }}
          >
            Create App
          </div>
        )
      : null,
}))

vi.mock('@/app/components/app/create-from-dsl-modal', () => ({
  default: ({ show, onClose, onSuccess }: { show: boolean, onClose: () => void, onSuccess: () => void }) =>
    show
      ? (
          <div
            data-testid="create-from-dsl-modal"
            onClick={() => {
              onClose()
              onSuccess()
            }}
          >
            Create from DSL
          </div>
        )
      : null,
}))

vi.mock('../nav', () => ({
  default: ({ onCreate, onLoadMore }: { onCreate: (state: string) => void, onLoadMore?: () => void }) => (
    <div data-testid="nav">
      <button onClick={() => onCreate('blank')} data-testid="create-blank">
        Create Blank
      </button>
      <button onClick={() => onCreate('template')} data-testid="create-template">
        Create Template
      </button>
      <button onClick={() => onCreate('dsl')} data-testid="create-dsl">
        Create DSL
      </button>
      <button onClick={onLoadMore} data-testid="load-more">
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
  {
    id: 'app-2',
    name: 'App 2',
    mode: AppModeEnum.WORKFLOW,
    icon_type: 'emoji',
    icon: '⚙️',
    icon_background: null,
    icon_url: null,
  },
]

const createDefaultMocks = () => {
  vi.mocked(useParams).mockReturnValue({ appId: 'app-1' } as unknown as ReturnType<typeof useParams>)
  vi.mocked(useAppContext).mockReturnValue({
    isCurrentWorkspaceEditor: false,
  } as unknown as ReturnType<typeof useAppContext>)
  vi.mocked(useAppStore).mockImplementation((selector: unknown) =>
    (selector as (state: unknown) => unknown)({ appDetail: null }),
  )
  vi.mocked(useInfiniteAppList).mockReturnValue({
    data: { pages: [{ data: mockAppData }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useInfiniteAppList>)
}

describe('AppNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createDefaultMocks()
  })

  it('should render navigation', () => {
    render(<AppNav />)
    expect(screen.getByTestId('nav')).toBeInTheDocument()
  })

  it('should open create app modal when clicking create blank button', async () => {
    const user = userEvent.setup()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-blank'))

    await waitFor(() => {
      expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
    })
  })

  it('should close modal and refetch apps after successful creation', async () => {
    const refetchMock = vi.fn()
    vi.mocked(useInfiniteAppList).mockReturnValue({
      data: { pages: [{ data: mockAppData }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: refetchMock,
    } as unknown as ReturnType<typeof useInfiniteAppList>)

    const user = userEvent.setup()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-blank'))
    await waitFor(() => {
      expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('create-app-modal'))

    await waitFor(() => {
      expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      expect(refetchMock).toHaveBeenCalled()
    })
  })

  it('should open template dialog when clicking create template button', async () => {
    const user = userEvent.setup()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-template'))

    await waitFor(() => {
      expect(screen.getByTestId('create-app-template-dialog')).toBeInTheDocument()
    })
  })

  it('should open DSL modal when clicking create DSL button', async () => {
    const user = userEvent.setup()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-dsl'))

    await waitFor(() => {
      expect(screen.getByTestId('create-from-dsl-modal')).toBeInTheDocument()
    })
  })

  it('should load more apps when clicking load more button with more data available', async () => {
    const fetchNextPageMock = vi.fn()
    vi.mocked(useInfiniteAppList).mockReturnValue({
      data: { pages: [{ data: mockAppData }] },
      fetchNextPage: fetchNextPageMock,
      hasNextPage: true,
      isFetchingNextPage: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteAppList>)

    const user = userEvent.setup()
    render(<AppNav />)

    await user.click(screen.getByTestId('load-more'))

    expect(fetchNextPageMock).toHaveBeenCalled()
  })

  it('should not fetch more apps when no more data available', async () => {
    const fetchNextPageMock = vi.fn()
    vi.mocked(useInfiniteAppList).mockReturnValue({
      data: { pages: [{ data: mockAppData }] },
      fetchNextPage: fetchNextPageMock,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteAppList>)

    const user = userEvent.setup()
    render(<AppNav />)

    await user.click(screen.getByTestId('load-more'))

    expect(fetchNextPageMock).not.toHaveBeenCalled()
  })

  it('should generate workflow link for editor workspace with workflow app', () => {
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceEditor: true,
    } as unknown as ReturnType<typeof useAppContext>)

    vi.mocked(useInfiniteAppList).mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                id: 'workflow-app',
                name: 'Workflow App',
                mode: AppModeEnum.WORKFLOW,
                icon_type: 'emoji',
                icon: '⚙️',
                icon_background: null,
                icon_url: null,
              },
            ],
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteAppList>)

    render(<AppNav />)
    expect(screen.getByTestId('nav')).toBeInTheDocument()
  })

  it('should generate configuration link for editor workspace with non-workflow app', () => {
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceEditor: true,
    } as unknown as ReturnType<typeof useAppContext>)

    vi.mocked(useInfiniteAppList).mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                id: 'chat-app',
                name: 'Chat App',
                mode: AppModeEnum.AGENT_CHAT,
                icon_type: 'emoji',
                icon: '🤖',
                icon_background: null,
                icon_url: null,
              },
            ],
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteAppList>)

    render(<AppNav />)
    expect(screen.getByTestId('nav')).toBeInTheDocument()
  })

  it('should update nav item name when app detail changes', async () => {
    vi.mocked(useInfiniteAppList).mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                id: 'app-1',
                name: 'App 1',
                mode: AppModeEnum.AGENT_CHAT,
                icon_type: 'emoji',
                icon: '🤖',
                icon_background: null,
                icon_url: null,
              },
            ],
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteAppList>)

    const { rerender } = render(<AppNav />)

    await waitFor(() => {
      expect(screen.getByTestId('nav')).toBeInTheDocument()
    })

    vi.mocked(useAppStore).mockImplementation((selector: unknown) =>
      (selector as (state: unknown) => unknown)({
        appDetail: {
          id: 'app-1',
          name: 'Updated App Name',
        },
      }),
    )

    rerender(<AppNav />)

    await waitFor(() => {
      expect(screen.getByTestId('nav')).toBeInTheDocument()
    })
  })

  it('should refetch on all modal successes', async () => {
    const refetchMock = vi.fn()
    vi.mocked(useInfiniteAppList).mockReturnValue({
      data: { pages: [{ data: mockAppData }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: refetchMock,
    } as unknown as ReturnType<typeof useInfiniteAppList>)

    const user = userEvent.setup()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-template'))
    await waitFor(() => {
      expect(screen.getByTestId('create-app-template-dialog')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('create-app-template-dialog'))

    await waitFor(() => {
      expect(screen.queryByTestId('create-app-template-dialog')).not.toBeInTheDocument()
      expect(refetchMock).toHaveBeenCalled()
    })
  })

  it('should refetch on DSL modal success', async () => {
    const refetchMock = vi.fn()
    vi.mocked(useInfiniteAppList).mockReturnValue({
      data: { pages: [{ data: mockAppData }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: refetchMock,
    } as unknown as ReturnType<typeof useInfiniteAppList>)

    const user = userEvent.setup()
    render(<AppNav />)

    await user.click(screen.getByTestId('create-dsl'))
    await waitFor(() => {
      expect(screen.getByTestId('create-from-dsl-modal')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('create-from-dsl-modal'))

    await waitFor(() => {
      expect(screen.queryByTestId('create-from-dsl-modal')).not.toBeInTheDocument()
      expect(refetchMock).toHaveBeenCalled()
    })
  })
})
