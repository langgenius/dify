import { fireEvent, screen } from '@testing-library/react'
import * as React from 'react'
import { createSystemFeaturesWrapper } from '@/__tests__/utils/mock-system-features'
import { renderWithNuqs } from '@/test/nuqs-testing'
import SnippetList from '..'

const mockUseInfiniteSnippetList = vi.hoisted(() => vi.fn())
const mockSetKeywords = vi.hoisted(() => vi.fn())
const mockSetTagIDs = vi.hoisted(() => vi.fn())
const mockSetCreatorID = vi.hoisted(() => vi.fn())
const mockQueryState = vi.hoisted(() => ({
  tagIDs: [] as string[],
  keywords: '',
  creatorID: '',
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
    setCreatorID: mockSetCreatorID,
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
      queryKey: () => ['console', 'systemFeatures'],
    },
  },
}))

const mockIsCurrentWorkspaceEditor = vi.fn(() => true)
const mockIsCurrentWorkspaceDatasetOperator = vi.fn(() => false)
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor(),
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator(),
    isLoadingCurrentWorkspace: false,
    userProfile: { id: 'creator-1' },
  }),
}))

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
    return function MockDynamicComponent() {
      return React.createElement('div', { 'data-testid': 'tag-management-modal' })
    }
  },
}))

vi.mock('@/app/components/workflow/create-snippet-dialog', () => ({
  default: () => null,
}))

vi.mock('@/features/tag-management/components/tag-selector', () => ({
  TagSelector: () => <div data-testid="snippet-card-tags" />,
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

beforeAll(() => {
  globalThis.IntersectionObserver = class MockIntersectionObserver {
    constructor(_callback: IntersectionObserverCallback) {}

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

const renderList = () => {
  const { wrapper: SystemFeaturesWrapper } = createSystemFeaturesWrapper({
    systemFeatures: { branding: { enabled: false } },
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
    mockQueryState.creatorID = ''
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })
  })

  it('renders the dedicated snippets list layout', () => {
    renderList()

    expect(screen.getByText('app.studio.filters.allCreators')).toBeInTheDocument()
    expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('workflow.tabs.searchSnippets')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'snippet.create' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sales Snippet/ })).toHaveAttribute('href', '/snippets/snippet-1/orchestrate')
    expect(screen.getByTestId('tag-management-modal')).toBeInTheDocument()
  })

  it('passes creator, tag, and search filters to the snippets list query', () => {
    mockQueryState.tagIDs = ['tag-1', 'tag-2']
    mockQueryState.keywords = 'sales'
    mockQueryState.creatorID = 'creator-1'

    renderList()

    expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith({
      page: 1,
      limit: 30,
      keyword: 'sales',
      tag_ids: ['tag-1', 'tag-2'],
      creator_id: 'creator-1',
    }, {
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

  it('updates the creator query state as a single creator filter', () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'app.studio.filters.allCreators' }))
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }))

    expect(mockSetCreatorID).toHaveBeenCalledWith('creator-2')
  })

  it('hides the create button for non-editors', () => {
    mockIsCurrentWorkspaceEditor.mockReturnValue(false)

    renderList()

    expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
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
})
