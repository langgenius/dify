import { fireEvent, screen } from '@testing-library/react'
import * as React from 'react'
import { createSystemFeaturesWrapper } from '@/__tests__/utils/mock-system-features'
import { renderWithNuqs } from '@/test/nuqs-testing'
import SnippetList from '..'

const mockUseInfiniteSnippetList = vi.hoisted(() => vi.fn())
const mockSetKeywords = vi.hoisted(() => vi.fn())
const mockSetTagIDs = vi.hoisted(() => vi.fn())
const mockSetCreatorIDs = vi.hoisted(() => vi.fn())
const mockQueryState = vi.hoisted(() => ({
  tagIDs: [] as string[],
  keywords: '',
  creatorIDs: [] as string[],
}))

vi.mock('@/service/use-snippets', () => ({
  useCreateSnippetMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeleteSnippetMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useExportSnippetMutation: () => ({
    mutateAsync: vi.fn(),
  }),
  useImportSnippetDSLMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useConfirmSnippetImportMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useInfiniteSnippetList: (params: unknown, options: unknown) => mockUseInfiniteSnippetList(params, options),
  useUpdateSnippetMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('../hooks/use-snippets-query-state', () => ({
  useSnippetsQueryState: () => ({
    query: mockQueryState,
    setKeywords: mockSetKeywords,
    setTagIDs: mockSetTagIDs,
    setCreatorIDs: mockSetCreatorIDs,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    systemFeatures: vi.fn(),
  },
  consoleQuery: {
    tags: {
      list: {
        queryOptions: (options: unknown) => options,
      },
    },
    systemFeatures: {
      get: {
        queryKey: () => ['console', 'systemFeatures', 'get'],
      },
    },
  },
}))

const mockIsCurrentWorkspaceEditor = vi.fn(() => true)
const mockIsCurrentWorkspaceDatasetOperator = vi.fn(() => false)
const mockWorkspacePermissionKeys = vi.fn(() => ['snippets.create_and_modify'])

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'creator-1' },
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'creator-1' },
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'creator-1' },
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'creator-1' },
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'creator-1' },
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'creator-1', name: 'Alice', avatar_url: null, status: 'active' },
        { id: 'creator-2', name: 'Bob', avatar_url: null, status: 'active' },
      ],
    },
  }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/next/dynamic', () => ({
  default: () => {
    return function MockDynamicComponent(props: {
      show: boolean
      onClose: () => void
      onTagsChange: () => void
    }) {
      return React.createElement(
        'div',
        {
          'data-testid': 'tag-management-modal',
          'data-show': String(props.show),
        },
        React.createElement('button', { type: 'button', onClick: props.onClose }, 'close tag modal'),
        React.createElement('button', { type: 'button', onClick: props.onTagsChange }, 'refresh tags'),
      )
    }
  },
}))

vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: ({
    onOpenTagManagement,
  }: {
    onOpenTagManagement: () => void
  }) => (
    <button type="button" onClick={onOpenTagManagement}>
      common.tag.placeholder
    </button>
  ),
}))

vi.mock('@/app/components/snippets/create-snippet-dialog', () => ({
  default: () => null,
}))

vi.mock('@/features/tag-management/components/tag-selector', () => ({
  TagSelector: ({
    onOpenTagManagement,
    onTagsChange,
  }: {
    onOpenTagManagement: () => void
    onTagsChange: () => void
  }) => (
    <div data-testid="snippet-card-tags">
      <button type="button" onClick={onOpenTagManagement}>open card tags</button>
      <button type="button" onClick={onTagsChange}>refresh card tags</button>
    </div>
  ),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

let intersectionCallback: IntersectionObserverCallback | undefined
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

beforeAll(() => {
  globalThis.IntersectionObserver = class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      intersectionCallback = callback
    }

    observe = mockObserve
    disconnect = mockDisconnect
    unobserve = vi.fn()
    root = null
    rootMargin = ''
    thresholds = []
    takeRecords = () => []
  } as unknown as typeof IntersectionObserver
})

const mockRefetch = vi.fn()
const mockFetchNextPage = vi.fn()

const mockSnippetListState = {
  data: {
    pages: [{
      data: [
        {
          id: 'snippet-1',
          name: 'Sales Snippet',
          description: 'Builds a sales follow-up.',
          type: 'node',
          is_published: true,
          use_count: 12,
          tags: [],
          created_at: 1704067200,
          created_by: 'creator-1',
          updated_at: 1704153600,
          updated_by: 'creator-2',
        },
      ],
      page: 1,
      limit: 30,
      total: 1,
      has_more: false,
    }],
  },
  isLoading: false,
  isFetching: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  error: null as Error | null,
}

const renderList = ({
  brandingEnabled = false,
}: {
  brandingEnabled?: boolean
} = {}) => {
  const { wrapper: SystemFeaturesWrapper } = createSystemFeaturesWrapper({
    systemFeatures: { branding: { enabled: brandingEnabled } },
  })

  return renderWithNuqs(
    <SystemFeaturesWrapper>
      <SnippetList />
    </SystemFeaturesWrapper>,
  )
}

describe('SnippetList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryState.tagIDs = []
    mockQueryState.keywords = ''
    mockQueryState.creatorIDs = []
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })
    intersectionCallback = undefined
  })

  it('renders the dedicated snippets list layout', () => {
    renderList()

    expect(screen.getByRole('link', { name: 'common.menus.apps' })).toHaveAttribute('href', '/apps')
    expect(screen.getByRole('heading', { name: 'workflow.tabs.snippets' })).toBeInTheDocument()
    expect(screen.getByText('app.studio.filters.creators')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /workflow\.common\.published \/ snippet\.draft/i })).toBeInTheDocument()
    expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('workflow.tabs.searchSnippets')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'snippet.create' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sales Snippet/ })).toHaveAttribute('href', '/snippets/snippet-1/orchestrate')
    expect(screen.getByTestId('tag-management-modal')).toBeInTheDocument()
  })

  it('lays out snippet cards with auto-fill grid columns', () => {
    renderList()

    const card = screen.getByRole('link', { name: /Sales Snippet/ }).closest('article')
    const grid = card?.parentElement

    expect(grid).toHaveClass(
      'grid',
      'grid-cols-[repeat(auto-fill,minmax(296px,1fr))]',
    )
  })

  it('passes creator, tag, and search filters to the snippets list query', () => {
    mockQueryState.tagIDs = ['tag-1', 'tag-2']
    mockQueryState.keywords = 'sales'
    mockQueryState.creatorIDs = ['creator-1', 'creator-2']

    renderList()

    expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith({
      page: 1,
      limit: 30,
      keyword: 'sales',
      tag_ids: ['tag-1', 'tag-2'],
      creator_ids: ['creator-1', 'creator-2'],
    }, {
      enabled: true,
    })
  })

  it('does not pass published state to the snippets list query by default', () => {
    renderList()

    expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith(expect.not.objectContaining({
      is_published: expect.any(Boolean),
    }), {
      enabled: true,
    })
  })

  it('passes published state when selecting the published filter', () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: /workflow\.common\.published \/ snippet\.draft/i }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /workflow\.common\.published/i }))

    expect(mockUseInfiniteSnippetList).toHaveBeenLastCalledWith(expect.objectContaining({
      is_published: true,
    }), {
      enabled: true,
    })
  })

  it('passes draft state when selecting the draft filter', () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: /workflow\.common\.published \/ snippet\.draft/i }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /snippet\.draft/i }))

    expect(mockUseInfiniteSnippetList).toHaveBeenLastCalledWith(expect.objectContaining({
      is_published: false,
    }), {
      enabled: true,
    })
  })

  it('updates the search query state from the search input', () => {
    renderList()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'summary' } })

    expect(mockSetKeywords).toHaveBeenCalledWith('summary')
  })

  it('clears the search query state', () => {
    mockQueryState.keywords = 'summary'

    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(mockSetKeywords).toHaveBeenCalledWith('')
  })

  it('updates the creator query state as a multi creator filter', () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'app.studio.filters.creators' }))
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }))

    expect(mockSetCreatorIDs).toHaveBeenCalledWith(['creator-2'])
  })

  it('hides the create button without snippet create permission', () => {
    mockWorkspacePermissionKeys.mockReturnValue([])

    renderList()

    expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
  })

  it('fetches snippets without create action for users with snippet management permission', () => {
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.management'])

    renderList()

    expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith(expect.any(Object), {
      enabled: true,
    })
    expect(screen.getByRole('link', { name: /Sales Snippet/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
  })

  it('does not fetch or render snippets without snippet list permissions', () => {
    mockWorkspacePermissionKeys.mockReturnValue([])

    renderList()

    expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith(expect.any(Object), {
      enabled: false,
    })
    expect(screen.queryByRole('link', { name: /Sales Snippet/ })).not.toBeInTheDocument()
    expect(screen.getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
  })

  it('shows the create button for users with snippet create permission even when they are not workspace editors', () => {
    mockIsCurrentWorkspaceEditor.mockReturnValue(false)
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])

    renderList()

    expect(screen.getByRole('button', { name: 'snippet.create' })).toBeInTheDocument()
  })

  it('shows an empty state when no snippets are returned', () => {
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: {
        pages: [{
          data: [],
          page: 1,
          limit: 30,
          total: 0,
          has_more: false,
        }],
      },
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    renderList()

    expect(screen.getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
  })

  it('renders loading and next-page skeleton cards', () => {
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: { pages: [] },
      isLoading: true,
      isFetchingNextPage: true,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    const { container } = renderList()

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(9)
  })

  it('fetches the next page when the scroll anchor intersects', () => {
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      hasNextPage: true,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    renderList()

    intersectionCallback?.([
      { isIntersecting: true } as IntersectionObserverEntry,
    ], {} as IntersectionObserver)

    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('fetches snippets for dataset operators when they have snippet list permissions', () => {
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(true)

    renderList()

    expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith(expect.any(Object), {
      enabled: true,
    })
  })

  it('does not register infinite scroll without snippet list permissions', () => {
    mockWorkspacePermissionKeys.mockReturnValue([])

    renderList()

    intersectionCallback?.([
      { isIntersecting: true } as IntersectionObserverEntry,
    ], {} as IntersectionObserver)
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('opens tag management from filters and snippet cards and forwards tag refreshes', () => {
    renderList()

    expect(screen.getByTestId('tag-management-modal')).toHaveAttribute('data-show', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'common.tag.placeholder' }))

    expect(screen.getByTestId('tag-management-modal')).toHaveAttribute('data-show', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'close tag modal' }))

    expect(screen.getByTestId('tag-management-modal')).toHaveAttribute('data-show', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'open card tags' }))
    fireEvent.click(screen.getByRole('button', { name: 'refresh card tags' }))
    fireEvent.click(screen.getByRole('button', { name: 'refresh tags' }))

    expect(mockRefetch).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('tag-management-modal')).toHaveAttribute('data-show', 'true')
  })
})
