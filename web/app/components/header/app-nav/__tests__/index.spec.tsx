import { useInfiniteQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import { useParams } from '@/next/navigation'
import { AppModeEnum } from '@/types/app'
import AppNav from '../index'

const mockAppListInfiniteOptions = vi.hoisted(() => vi.fn((options: unknown) => options))

vi.mock('@/next/navigation', () => ({
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

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      list: {
        infiniteOptions: (options: unknown) => mockAppListInfiniteOptions(options),
      },
    },
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useInfiniteQuery: vi.fn(),
  }
})

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

vi.mock('../../nav', () => ({
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
const mockUseInfiniteQuery = vi.mocked(useInfiniteQuery)
let mockAppDetail: { id: string, name: string } | null = null
type AppListInfiniteOptions = {
  input: (pageParam: number) => { query: { page: number, limit: number, name: string } }
  getNextPageParam: (lastPage: { has_more: boolean, page: number }) => number | undefined
}

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
  mockUseInfiniteQuery.mockReturnValue({
    data: { pages: [{ data: options?.appData ?? mockAppData }] },
    fetchNextPage,
    hasNextPage: options?.hasNextPage ?? false,
    isFetchingNextPage: false,
    refetch,
  } as ReturnType<typeof useInfiniteQuery>)

  return { refetch, fetchNextPage }
}

describe('AppNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetail = null
    setupDefaultMocks()
  })

  it('should configure paged app list query options', () => {
    setupDefaultMocks()
    render(<AppNav />)

    const options = mockAppListInfiniteOptions.mock.calls.at(-1)?.[0] as AppListInfiniteOptions

    expect(options.input(3)).toEqual({
      query: {
        page: 3,
        limit: 30,
        name: '',
      },
    })
    expect(options.getNextPageParam({ has_more: true, page: 3 })).toBe(4)
    expect(options.getNextPageParam({ has_more: false, page: 3 })).toBeUndefined()
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

  // Non-editor link path: isCurrentWorkspaceEditor=false → link ends with /overview
  it('should build overview links when user is not editor', () => {
    // Arrange
    setupDefaultMocks({ isEditor: false })

    // Act
    render(<AppNav />)

    // Assert
    expect(screen.getByText('App 1 -> /app/app-1/overview')).toBeInTheDocument()
  })

  // !!appId false: query disabled, no nav items
  it('should render no nav items when appId is undefined', () => {
    // Arrange
    setupDefaultMocks()
    mockUseParams.mockReturnValue({} as ReturnType<typeof useParams>)
    mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteQuery>)

    // Act
    render(<AppNav />)

    // Assert
    const navItems = screen.getByTestId('nav-items')
    expect(navItems.children).toHaveLength(0)
  })

  // ADVANCED_CHAT OR branch: editor + ADVANCED_CHAT mode → link ends with /workflow
  it('should build workflow link for ADVANCED_CHAT mode when user is editor', () => {
    // Arrange
    setupDefaultMocks({
      isEditor: true,
      appData: [
        {
          id: 'app-3',
          name: 'Chat App',
          mode: AppModeEnum.ADVANCED_CHAT,
          icon_type: 'emoji',
          icon: '💬',
          icon_background: null,
          icon_url: null,
        },
      ],
    })

    // Act
    render(<AppNav />)

    // Assert
    expect(screen.getByText('Chat App -> /app/app-3/workflow')).toBeInTheDocument()
  })

  // No-match update path: appDetail.id doesn't match any nav item
  it('should not change nav item names when appDetail id does not match any item', async () => {
    // Arrange
    setupDefaultMocks({ isEditor: true })
    const { rerender } = render(<AppNav />)

    // Act - set appDetail to a non-matching id
    mockAppDetail = { id: 'non-existent-id', name: 'Unknown' }
    rerender(<AppNav />)

    // Assert - original name should be unchanged
    await waitFor(() => {
      expect(screen.getByText('App 1 -> /app/app-1/configuration')).toBeInTheDocument()
    })
  })
})
