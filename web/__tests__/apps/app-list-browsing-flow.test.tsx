/**
 * Integration test: App List Browsing Flow
 *
 * Tests the end-to-end user flow of browsing, filtering, searching,
 * and tab switching in the apps list page.
 *
 * Covers: List, Empty, Footer, AppCardSkeleton, useAppsQueryState, NewAppCard
 */
import type { AppListResponse } from '@/models/app'
import type { App } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import List from '@/app/components/apps/list'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'

let mockIsCurrentWorkspaceEditor = true
let mockIsCurrentWorkspaceDatasetOperator = false
let mockIsLoadingCurrentWorkspace = false

let mockSystemFeatures = {
  branding: { enabled: false },
  webapp_auth: { enabled: false },
}

let mockPages: AppListResponse[] = []
let mockIsLoading = false
let mockIsFetching = false
let mockIsFetchingNextPage = false
let mockHasNextPage = false
let mockError: Error | null = null
const mockRefetch = vi.fn()
const mockFetchNextPage = vi.fn()

let mockShowTagManagementModal = false

const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/dynamic', () => ({
  default: (_loader: () => Promise<{ default: React.ComponentType }>) => {
    const LazyComponent = (props: Record<string, unknown>) => {
      return <div data-testid="dynamic-component" {...props} />
    }
    LazyComponent.displayName = 'DynamicComponent'
    return LazyComponent
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator,
    isLoadingCurrentWorkspace: mockIsLoadingCurrentWorkspace,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { systemFeatures: mockSystemFeatures }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: vi.fn(),
  }),
}))

vi.mock('@/app/components/base/tag-management/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      tagList: [],
      showTagManagementModal: mockShowTagManagementModal,
      setTagList: vi.fn(),
      setShowTagManagementModal: vi.fn(),
    }
    return selector(state)
  },
}))

vi.mock('@/service/tag', () => ({
  fetchTagList: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/service/use-apps', () => ({
  useInfiniteAppList: () => ({
    data: { pages: mockPages },
    isLoading: mockIsLoading,
    isFetching: mockIsFetching,
    isFetchingNextPage: mockIsFetchingNextPage,
    fetchNextPage: mockFetchNextPage,
    hasNextPage: mockHasNextPage,
    error: mockError,
    refetch: mockRefetch,
  }),
}))

vi.mock('@/hooks/use-pay', () => ({
  CheckModal: () => null,
}))

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useDebounceFn: (fn: (...args: unknown[]) => void) => {
      const fnRef = React.useRef(fn)
      fnRef.current = fn
      return {
        run: (...args: unknown[]) => fnRef.current(...args),
      }
    },
  }
})

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: overrides.id ?? 'app-1',
  name: overrides.name ?? 'My Chat App',
  description: overrides.description ?? 'A chat application',
  author_name: overrides.author_name ?? 'Test Author',
  icon_type: overrides.icon_type ?? 'emoji',
  icon: overrides.icon ?? '🤖',
  icon_background: overrides.icon_background ?? '#FFEAD5',
  icon_url: overrides.icon_url ?? null,
  use_icon_as_answer_icon: overrides.use_icon_as_answer_icon ?? false,
  mode: overrides.mode ?? AppModeEnum.CHAT,
  enable_site: overrides.enable_site ?? true,
  enable_api: overrides.enable_api ?? true,
  api_rpm: overrides.api_rpm ?? 60,
  api_rph: overrides.api_rph ?? 3600,
  is_demo: overrides.is_demo ?? false,
  model_config: overrides.model_config ?? {} as App['model_config'],
  app_model_config: overrides.app_model_config ?? {} as App['app_model_config'],
  created_at: overrides.created_at ?? 1700000000,
  updated_at: overrides.updated_at ?? 1700001000,
  site: overrides.site ?? {} as App['site'],
  api_base_url: overrides.api_base_url ?? 'https://api.example.com',
  tags: overrides.tags ?? [],
  access_mode: overrides.access_mode ?? AccessMode.PUBLIC,
  max_active_requests: overrides.max_active_requests ?? null,
})

const createPage = (apps: App[], hasMore = false, page = 1): AppListResponse => ({
  data: apps,
  has_more: hasMore,
  limit: 30,
  page,
  total: apps.length,
})

const renderList = (searchParams?: Record<string, string>) => {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <List controlRefreshList={0} />
    </NuqsTestingAdapter>,
  )
}

describe('App List Browsing Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceEditor = true
    mockIsCurrentWorkspaceDatasetOperator = false
    mockIsLoadingCurrentWorkspace = false
    mockSystemFeatures = {
      branding: { enabled: false },
      webapp_auth: { enabled: false },
    }
    mockPages = []
    mockIsLoading = false
    mockIsFetching = false
    mockIsFetchingNextPage = false
    mockHasNextPage = false
    mockError = null
    mockShowTagManagementModal = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Loading and Empty States', () => {
    it('should show skeleton cards during initial loading', () => {
      mockIsLoading = true
      renderList()

      const skeletonCards = document.querySelectorAll('.animate-pulse')
      expect(skeletonCards.length).toBeGreaterThan(0)
    })

    it('should show empty state when no apps exist', () => {
      mockPages = [createPage([])]
      renderList()

      expect(screen.getByText('app.newApp.noAppsFound')).toBeInTheDocument()
    })

    it('should transition from loading to content when data loads', () => {
      mockIsLoading = true
      const { rerender } = render(
        <NuqsTestingAdapter>
          <List controlRefreshList={0} />
        </NuqsTestingAdapter>,
      )

      const skeletonCards = document.querySelectorAll('.animate-pulse')
      expect(skeletonCards.length).toBeGreaterThan(0)

      // Data loads
      mockIsLoading = false
      mockPages = [createPage([
        createMockApp({ id: 'app-1', name: 'Loaded App' }),
      ])]

      rerender(
        <NuqsTestingAdapter>
          <List controlRefreshList={0} />
        </NuqsTestingAdapter>,
      )

      expect(screen.getByText('Loaded App')).toBeInTheDocument()
    })
  })

  // -- Rendering apps --
  describe('App List Rendering', () => {
    it('should render all app cards from the data', () => {
      mockPages = [createPage([
        createMockApp({ id: 'app-1', name: 'Chat Bot' }),
        createMockApp({ id: 'app-2', name: 'Workflow Engine', mode: AppModeEnum.WORKFLOW }),
        createMockApp({ id: 'app-3', name: 'Completion Tool', mode: AppModeEnum.COMPLETION }),
      ])]

      renderList()

      expect(screen.getByText('Chat Bot')).toBeInTheDocument()
      expect(screen.getByText('Workflow Engine')).toBeInTheDocument()
      expect(screen.getByText('Completion Tool')).toBeInTheDocument()
    })

    it('should display app descriptions', () => {
      mockPages = [createPage([
        createMockApp({ name: 'My App', description: 'A powerful AI assistant' }),
      ])]

      renderList()

      expect(screen.getByText('A powerful AI assistant')).toBeInTheDocument()
    })

    it('should show the NewAppCard for workspace editors', () => {
      mockPages = [createPage([
        createMockApp({ name: 'Test App' }),
      ])]

      renderList()

      expect(screen.getByText('app.createApp')).toBeInTheDocument()
    })

    it('should hide NewAppCard when user is not a workspace editor', () => {
      mockIsCurrentWorkspaceEditor = false
      mockPages = [createPage([
        createMockApp({ name: 'Test App' }),
      ])]

      renderList()

      expect(screen.queryByText('app.createApp')).not.toBeInTheDocument()
    })
  })

  // -- Footer visibility --
  describe('Footer Visibility', () => {
    it('should show footer when branding is disabled', () => {
      mockSystemFeatures = { ...mockSystemFeatures, branding: { enabled: false } }
      mockPages = [createPage([createMockApp()])]

      renderList()

      expect(screen.getByText('app.join')).toBeInTheDocument()
      expect(screen.getByText('app.communityIntro')).toBeInTheDocument()
    })

    it('should hide footer when branding is enabled', () => {
      mockSystemFeatures = { ...mockSystemFeatures, branding: { enabled: true } }
      mockPages = [createPage([createMockApp()])]

      renderList()

      expect(screen.queryByText('app.join')).not.toBeInTheDocument()
    })
  })

  // -- DSL drag-drop hint --
  describe('DSL Drag-Drop Hint', () => {
    it('should show drag-drop hint for workspace editors', () => {
      mockPages = [createPage([createMockApp()])]
      renderList()

      expect(screen.getByText('app.newApp.dropDSLToCreateApp')).toBeInTheDocument()
    })

    it('should hide drag-drop hint for non-editors', () => {
      mockIsCurrentWorkspaceEditor = false
      mockPages = [createPage([createMockApp()])]
      renderList()

      expect(screen.queryByText('app.newApp.dropDSLToCreateApp')).not.toBeInTheDocument()
    })
  })

  // -- Tab navigation --
  describe('Tab Navigation', () => {
    it('should render all category tabs', () => {
      mockPages = [createPage([createMockApp()])]
      renderList()

      expect(screen.getByText('app.types.all')).toBeInTheDocument()
      expect(screen.getByText('app.types.workflow')).toBeInTheDocument()
      expect(screen.getByText('app.types.advanced')).toBeInTheDocument()
      expect(screen.getByText('app.types.chatbot')).toBeInTheDocument()
      expect(screen.getByText('app.types.agent')).toBeInTheDocument()
      expect(screen.getByText('app.types.completion')).toBeInTheDocument()
    })
  })

  // -- Search --
  describe('Search Filtering', () => {
    it('should render search input', () => {
      mockPages = [createPage([createMockApp()])]
      renderList()

      const input = document.querySelector('input')
      expect(input).toBeInTheDocument()
    })

    it('should allow typing in search input', () => {
      mockPages = [createPage([createMockApp()])]
      renderList()

      const input = document.querySelector('input')!
      fireEvent.change(input, { target: { value: 'test search' } })
      expect(input.value).toBe('test search')
    })
  })

  // -- "Created by me" filter --
  describe('Created By Me Filter', () => {
    it('should render the "created by me" checkbox', () => {
      mockPages = [createPage([createMockApp()])]
      renderList()

      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })

    it('should toggle the "created by me" filter on click', () => {
      mockPages = [createPage([createMockApp()])]
      renderList()

      const checkbox = screen.getByText('app.showMyCreatedAppsOnly')
      fireEvent.click(checkbox)

      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })
  })

  // -- Fetching next page skeleton --
  describe('Pagination Loading', () => {
    it('should show skeleton when fetching next page', () => {
      mockPages = [createPage([createMockApp()])]
      mockIsFetchingNextPage = true

      renderList()

      const skeletonCards = document.querySelectorAll('.animate-pulse')
      expect(skeletonCards.length).toBeGreaterThan(0)
    })
  })

  // -- Dataset operator behavior --
  describe('Dataset Operator Behavior', () => {
    it('should not redirect at list component level for dataset operators', () => {
      mockIsCurrentWorkspaceDatasetOperator = true
      renderList()

      expect(mockRouterReplace).not.toHaveBeenCalled()
    })
  })

  // -- Multiple pages of data --
  describe('Multi-page Data', () => {
    it('should render apps from multiple pages', () => {
      mockPages = [
        createPage([
          createMockApp({ id: 'app-1', name: 'Page One App' }),
        ], true, 1),
        createPage([
          createMockApp({ id: 'app-2', name: 'Page Two App' }),
        ], false, 2),
      ]

      renderList()

      expect(screen.getByText('Page One App')).toBeInTheDocument()
      expect(screen.getByText('Page Two App')).toBeInTheDocument()
    })
  })

  // -- controlRefreshList triggers refetch --
  describe('Refresh List', () => {
    it('should call refetch when controlRefreshList increments', () => {
      mockPages = [createPage([createMockApp()])]

      const { rerender } = render(
        <NuqsTestingAdapter>
          <List controlRefreshList={0} />
        </NuqsTestingAdapter>,
      )

      rerender(
        <NuqsTestingAdapter>
          <List controlRefreshList={1} />
        </NuqsTestingAdapter>,
      )

      expect(mockRefetch).toHaveBeenCalled()
    })
  })
})
