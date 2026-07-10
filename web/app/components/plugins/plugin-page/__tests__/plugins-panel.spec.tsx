import type { PluginDetail } from '../../types'
import type { Collection } from '@/app/components/tools/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStepByStepTourTargetSelector, STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { PluginCategoryEnum } from '../../types'
import PluginsPanel from '../plugins-panel'

const mockState = vi.hoisted(() => ({
  filters: {
    categories: [] as string[],
    tags: [] as string[],
    searchQuery: '',
  },
  currentPluginID: undefined as string | undefined,
}))

const mockSetFilters = vi.fn()
const mockSetCurrentPluginID = vi.fn()
const mockLoadNextPage = vi.fn()
const mockInvalidateInstalledPluginList = vi.fn()
const mockUseInstalledPluginList = vi.fn()
const mockPluginListWithLatestVersion = vi.fn<() => PluginDetail[]>(() => [])

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useSuspenseQuery: () => ({ data: true }),
}))
vi.mock('@/i18n-config', () => ({
  renderI18nObject: (value: Record<string, string>, locale: string) => value[locale] || '',
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: (...args: unknown[]) => mockUseInstalledPluginList(...args),
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

vi.mock('../../hooks', () => ({
  usePluginsWithLatestVersion: () => mockPluginListWithLatestVersion(),
  useTags: () => ({
    getTagLabel: (label: string) => label,
  }),
}))

vi.mock('../context', () => ({
  usePluginPageContext: (selector: (value: {
    filters: typeof mockState.filters
    setFilters: typeof mockSetFilters
    currentPluginID: string | undefined
    setCurrentPluginID: typeof mockSetCurrentPluginID
  }) => unknown) => selector({
    filters: mockState.filters,
    setFilters: mockSetFilters,
    currentPluginID: mockState.currentPluginID,
    setCurrentPluginID: mockSetCurrentPluginID,
  }),
}))

vi.mock('../filter-management', () => ({
  default: ({ hideCategoryFilter, hideTagFilter, onFilterChange, rightSlot }: {
    hideCategoryFilter?: boolean
    hideTagFilter?: boolean
    onFilterChange: (filters: typeof mockState.filters) => void
    rightSlot?: React.ReactNode
  }) => (
    <div data-testid="filter-management-wrap">
      <button
        data-testid="filter-management"
        data-hide-category-filter={hideCategoryFilter ? 'true' : 'false'}
        data-hide-tag-filter={hideTagFilter ? 'true' : 'false'}
        onClick={() => onFilterChange({
          categories: [],
          tags: [],
          searchQuery: 'beta',
        })}
      >
        filter
      </button>
      {rightSlot}
    </div>
  ),
}))

vi.mock('../empty', () => ({
  default: ({ canInstall, contentInset, onSwitchToMarketplace, variant }: { canInstall?: boolean, contentInset?: string, onSwitchToMarketplace?: () => void, variant?: string }) => (
    <div data-can-install={canInstall ? 'true' : 'false'} data-content-inset={contentInset} data-has-marketplace-action={onSwitchToMarketplace ? 'true' : 'false'} data-testid="empty-state" data-variant={variant}>empty</div>
  ),
}))

vi.mock('../list', () => ({
  default: ({ children, firstPluginTarget, pluginList }: { children?: React.ReactNode, firstPluginTarget?: string, pluginList: PluginDetail[] }) => (
    <div data-testid="plugin-list">
      {pluginList.map((plugin, index) => (
        <div
          key={plugin.plugin_id}
          data-step-by-step-tour-target={index === 0 ? firstPluginTarget : undefined}
          data-testid="plugin-list-item"
        >
          {plugin.plugin_id}
        </div>
      ))}
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/integrations/tool-provider-card', () => ({
  default: ({ collection, showBuiltInBadge }: { collection: Collection, showBuiltInBadge?: boolean }) => (
    <div data-show-built-in-badge={showBuiltInBadge ? 'true' : 'false'} data-testid="builtin-tool-card">
      {collection.id}
    </div>
  ),
}))

vi.mock('@/app/components/integrations/hooks/use-tool-marketplace-panel', () => ({
  useToolMarketplacePanel: () => ({
    isMarketplaceArrowVisible: true,
    marketplaceContext: {},
    showMarketplacePanel: vi.fn(),
    toolListTailRef: { current: null },
  }),
}))

vi.mock('@/app/components/tools/marketplace', () => ({
  default: ({ filterPluginTags, searchPluginText }: { filterPluginTags: string[], searchPluginText: string }) => (
    <div data-filter-plugin-tags={filterPluginTags.join(',')} data-search-plugin-text={searchPluginText} data-testid="tool-marketplace" />
  ),
}))

vi.mock('@/app/components/tools/provider/detail', () => ({
  default: ({ collection, onHide }: { collection: Collection, onHide: () => void }) => (
    <div data-testid="builtin-tool-detail">
      <span>{collection.id}</span>
      <button type="button" onClick={onHide}>hide builtin detail</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({ detail, onHide, onUpdate }: {
    detail?: PluginDetail
    onHide: () => void
    onUpdate: () => void
  }) => (
    <div data-testid="plugin-detail-panel">
      <span>{detail?.plugin_id ?? 'none'}</span>
      <button onClick={onHide}>hide detail</button>
      <button onClick={onUpdate}>refresh detail</button>
    </div>
  ),
}))

const createPlugin = (pluginId: string, label: string, tags: string[] = [], category: PluginCategoryEnum = PluginCategoryEnum.tool): PluginDetail => ({
  id: pluginId,
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: label,
  plugin_id: pluginId,
  plugin_unique_identifier: `${pluginId}-uid`,
  declaration: {
    category,
    name: pluginId,
    label: { en_US: label },
    description: { en_US: `${label} description` },
    tags,
  } as PluginDetail['declaration'],
  installation_id: `${pluginId}-install`,
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: `${pluginId}-uid`,
  source: 'marketplace' as PluginDetail['source'],
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
}) as PluginDetail

const createBuiltinTool = (id: string, label: string, labels: string[] = []): Collection => ({
  id,
  name: id,
  author: 'Dify',
  description: { en_US: `${label} description`, zh_Hans: `${label} description` },
  icon: '',
  label: { en_US: label, zh_Hans: label },
  type: 'builtin',
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels,
})

describe('PluginsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockState.filters = { categories: [], tags: [], searchQuery: '' }
    mockState.currentPluginID = undefined
    mockUseInstalledPluginList.mockReturnValue({
      data: { plugins: [] },
      isLoading: false,
      isFetching: false,
      isLastPage: true,
      loadNextPage: mockLoadNextPage,
    })
    mockPluginListWithLatestVersion.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the loading state while the plugin list is pending', () => {
    mockUseInstalledPluginList.mockReturnValue({
      data: { plugins: [] },
      isLoading: true,
      isFetching: false,
      isLastPage: true,
      loadNextPage: mockLoadNextPage,
    })

    render(<PluginsPanel />)

    const loadingState = screen.getByRole('status')

    expect(loadingState).toHaveClass('px-12')
    expect(screen.getAllByTestId('plugin-card-skeleton')).toHaveLength(6)
  })

  it('uses compact skeleton spacing while an integrations plugin category is pending', () => {
    mockUseInstalledPluginList.mockReturnValue({
      data: { plugins: [] },
      isLoading: true,
      isFetching: false,
      isLastPage: true,
      loadNextPage: mockLoadNextPage,
    })

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.tool} />)

    const loadingState = screen.getByRole('status')

    expect(loadingState).toHaveClass('px-6', 'max-w-[1600px]')
    expect(screen.getAllByTestId('plugin-card-skeleton')).toHaveLength(6)
  })

  it('uses default content inset for the standalone plugins page', () => {
    render(<PluginsPanel />)

    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('px-12')
    expect(screen.getByTestId('filter-management-wrap').parentElement).not.toHaveClass('max-w-[1600px]')
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-content-inset', 'default')
  })

  it('uses compact content inset for integrations plugin categories', () => {
    render(<PluginsPanel contentInset="compact" />)

    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('px-6')
    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('max-w-[1600px]')
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-content-inset', 'compact')
  })

  it('hides category filtering UI and locks the list to the fixed category', () => {
    mockState.filters.categories = []
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('trigger-plugin', 'Trigger Plugin', [], PluginCategoryEnum.trigger),
      createPlugin('tool-plugin', 'Tool Plugin', [], PluginCategoryEnum.tool),
    ])

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.trigger} />)

    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-category-filter', 'true')
    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-tag-filter', 'false')
    expect(screen.getByTestId('plugin-list')).toHaveTextContent('trigger-plugin')
    expect(screen.getByTestId('plugin-list')).not.toHaveTextContent('tool-plugin')
  })

  it('loads the scoped plugin category list whenever an integrations category panel mounts', () => {
    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.trigger} />)

    expect(mockUseInstalledPluginList).toHaveBeenCalledWith(false, 100, {
      category: PluginCategoryEnum.trigger,
      refetchOnMount: 'always',
    })
  })

  it('loads the scoped tool plugin category list when fixed to tool plugins', () => {
    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.tool} />)

    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-tag-filter', 'false')
    expect(mockUseInstalledPluginList).toHaveBeenCalledWith(false, 100, {
      category: PluginCategoryEnum.tool,
      refetchOnMount: 'always',
    })
  })

  it('filters tool plugins, builtin tools, and marketplace suggestions by selected tags', () => {
    mockState.filters.tags = ['search']
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('search-tool-plugin', 'Search Tool Plugin', ['search'], PluginCategoryEnum.tool),
      createPlugin('rag-tool-plugin', 'RAG Tool Plugin', ['rag'], PluginCategoryEnum.tool),
    ])
    mockUseInstalledPluginList.mockReturnValue({
      data: {
        plugins: [],
        builtin_tools: [
          createBuiltinTool('search-builtin-tool', 'Search Builtin Tool', ['search']),
          createBuiltinTool('rag-builtin-tool', 'RAG Builtin Tool', ['rag']),
        ],
      },
      isLoading: false,
      isFetching: false,
      isLastPage: true,
      loadNextPage: mockLoadNextPage,
    })

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.tool} />)

    expect(screen.getByTestId('plugin-list')).toHaveTextContent('search-tool-plugin')
    expect(screen.getByTestId('plugin-list')).not.toHaveTextContent('rag-tool-plugin')
    expect(screen.getByTestId('builtin-tool-card')).toHaveTextContent('search-builtin-tool')
    expect(screen.getByTestId('plugin-list')).not.toHaveTextContent('rag-builtin-tool')
    expect(screen.getByTestId('tool-marketplace')).toHaveAttribute('data-filter-plugin-tags', 'search')
  })

  it('renders builtin tools after plugin tools on the tool integrations page', () => {
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('tool-plugin', 'Tool Plugin', [], PluginCategoryEnum.tool),
    ])
    mockUseInstalledPluginList.mockReturnValue({
      data: {
        plugins: [],
        builtin_tools: [
          createBuiltinTool('builtin-tool', 'Builtin Tool'),
        ],
      },
      isLoading: false,
      isFetching: false,
      isLastPage: true,
      loadNextPage: mockLoadNextPage,
    })

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.tool} />)

    const pluginList = screen.getByTestId('plugin-list')
    const pluginItem = screen.getByTestId('plugin-list-item')
    const builtinToolCard = screen.getByTestId('builtin-tool-card')

    expect(pluginList).toHaveTextContent('tool-plugin')
    expect(builtinToolCard).toHaveTextContent('builtin-tool')
    expect(builtinToolCard).toHaveAttribute('data-show-built-in-badge', 'true')
    expect(pluginList).toContainElement(builtinToolCard)
    expect(screen.getByRole('button', { name: 'builtin-tool' })).toHaveAttribute('aria-pressed', 'false')
    expect(pluginItem.compareDocumentPosition(builtinToolCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the builtin tool detail from the builtin tools list', () => {
    mockUseInstalledPluginList.mockReturnValue({
      data: {
        plugins: [],
        builtin_tools: [
          createBuiltinTool('builtin-tool', 'Builtin Tool'),
        ],
      },
      isLoading: false,
      isFetching: false,
      isLastPage: true,
      loadNextPage: mockLoadNextPage,
    })

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.tool} />)

    fireEvent.click(screen.getByTestId('builtin-tool-card'))

    expect(screen.getByTestId('builtin-tool-detail')).toHaveTextContent('builtin-tool')

    fireEvent.click(screen.getByText('hide builtin detail'))

    expect(screen.queryByTestId('builtin-tool-detail')).not.toBeInTheDocument()
  })

  it('filters builtin tools with the tool integrations search query', () => {
    mockState.filters.searchQuery = 'alpha'
    mockUseInstalledPluginList.mockReturnValue({
      data: {
        plugins: [],
        builtin_tools: [
          createBuiltinTool('alpha-builtin-tool', 'Alpha Builtin Tool'),
          createBuiltinTool('beta-builtin-tool', 'Beta Builtin Tool'),
        ],
      },
      isLoading: false,
      isFetching: false,
      isLastPage: true,
      loadNextPage: mockLoadNextPage,
    })

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.tool} />)

    expect(screen.getByTestId('builtin-tool-card')).toHaveTextContent('alpha-builtin-tool')
    expect(screen.getByTestId('plugin-list')).not.toHaveTextContent('beta-builtin-tool')
  })

  it('keeps the tool marketplace below the tool plugin list', () => {
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('tool-plugin', 'Tool Plugin', [], PluginCategoryEnum.tool),
    ])

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.tool} />)

    expect(screen.getByTestId('tool-marketplace')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-list').compareDocumentPosition(screen.getByTestId('tool-marketplace')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses the Figma trigger toolbar frame and renders the toolbar action', () => {
    render(
      <PluginsPanel
        contentInset="compact"
        fixedCategory={PluginCategoryEnum.trigger}
        toolbarAction={<button type="button">update setting</button>}
      />,
    )

    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('h-12', 'py-2', 'max-w-[1600px]', 'px-6')
    expect(screen.getByTestId('filter-management-wrap').parentElement).not.toHaveClass('sticky', 'top-0', 'z-10')
    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('bg-components-panel-bg')
    expect(screen.getByText('update setting')).toBeInTheDocument()
  })

  it('uses the Figma agent strategy toolbar frame and renders the toolbar action', () => {
    render(
      <PluginsPanel
        contentInset="compact"
        fixedCategory={PluginCategoryEnum.agent}
        toolbarAction={<button type="button">update setting</button>}
      />,
    )

    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('h-12', 'py-2', 'max-w-[1600px]', 'px-6')
    expect(screen.getByTestId('filter-management-wrap').parentElement).not.toHaveClass('sticky', 'top-0', 'z-10')
    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('bg-components-panel-bg')
    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-category-filter', 'true')
    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-tag-filter', 'true')
    expect(screen.getByText('update setting')).toBeInTheDocument()
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-variant', 'integrationsAgentStrategy')
  })

  it('passes install permission to the integration category empty state', () => {
    render(<PluginsPanel canInstall={false} contentInset="compact" fixedCategory={PluginCategoryEnum.trigger} />)

    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-can-install', 'false')
  })

  it('uses the Figma extension toolbar frame and renders the extension empty state', () => {
    render(
      <PluginsPanel
        contentInset="compact"
        fixedCategory={PluginCategoryEnum.extension}
        toolbarAction={<button type="button">update setting</button>}
      />,
    )

    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('h-12', 'py-2', 'max-w-[1600px]', 'px-6')
    expect(screen.getByTestId('filter-management-wrap').parentElement).not.toHaveClass('sticky', 'top-0', 'z-10')
    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-category-filter', 'true')
    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-tag-filter', 'true')
    expect(screen.getByText('update setting')).toBeInTheDocument()
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-variant', 'integrationsExtension')
  })

  it('passes the marketplace action to the empty state', () => {
    const onSwitchToMarketplace = vi.fn()

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.extension} onSwitchToMarketplace={onSwitchToMarketplace} />)

    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-has-marketplace-action', 'true')
  })

  it('ignores hidden tag filters within the fixed extension integrations category', () => {
    mockState.filters.tags = ['search']
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('rag-extension', 'Rag Extension', ['rag'], PluginCategoryEnum.extension),
      createPlugin('search-extension', 'Search Extension', ['search'], PluginCategoryEnum.extension),
    ])

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.extension} />)

    expect(screen.getByTestId('plugin-list')).toHaveTextContent('search-extension')
    expect(screen.getByTestId('plugin-list')).toHaveTextContent('rag-extension')
  })

  it.each([
    [PluginCategoryEnum.trigger, 'trigger-plugin', STEP_BY_STEP_TOUR_TARGETS.integrationTriggerGrid],
    [PluginCategoryEnum.agent, 'agent-plugin', STEP_BY_STEP_TOUR_TARGETS.integrationAgentStrategyEmpty],
    [PluginCategoryEnum.extension, 'extension-plugin', STEP_BY_STEP_TOUR_TARGETS.integrationExtensionGrid],
  ] as const)('anchors the %s integration tour target to the first plugin result', (category, pluginId, targetName) => {
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin(pluginId, pluginId, [], category),
      createPlugin(`${pluginId}-2`, `${pluginId} 2`, [], category),
    ])

    render(<PluginsPanel contentInset="compact" fixedCategory={category} />)

    const selector = getStepByStepTourTargetSelector(targetName)

    expect(document.querySelector(selector)).toBe(screen.getAllByTestId('plugin-list-item')[0])
    expect(document.querySelector(selector)).not.toBe(screen.getByTestId('plugin-list'))
  })

  it('leaves the result area blank when a fixed integrations category search has no matches', () => {
    mockState.filters.searchQuery = 'missing'
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('trigger-plugin', 'Trigger Plugin', [], PluginCategoryEnum.trigger),
      createPlugin('agent-plugin', 'Agent Plugin', [], PluginCategoryEnum.agent),
    ])

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.trigger} />)

    expect(screen.queryByTestId('plugin-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
  })

  it('filters the list and exposes the load-more action', () => {
    mockState.filters.searchQuery = 'alpha'
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('alpha-tool', 'Alpha Tool', ['search']),
      createPlugin('beta-tool', 'Beta Tool', ['rag']),
    ])
    mockUseInstalledPluginList.mockReturnValue({
      data: { plugins: [] },
      isLoading: false,
      isFetching: false,
      isLastPage: false,
      loadNextPage: mockLoadNextPage,
    })

    render(<PluginsPanel />)

    expect(screen.getByTestId('plugin-list')).toHaveTextContent('alpha-tool')
    expect(screen.queryByText('beta-tool')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('workflow.common.loadMore'))
    fireEvent.click(screen.getByTestId('filter-management'))
    vi.runAllTimers()

    expect(mockLoadNextPage).toHaveBeenCalled()
    expect(mockSetFilters).toHaveBeenCalledWith({
      categories: [],
      tags: [],
      searchQuery: 'beta',
    })
  })

  it('renders the empty state and keeps the current plugin detail in sync', () => {
    mockState.currentPluginID = 'beta-tool'
    mockState.filters.searchQuery = 'missing'
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('beta-tool', 'Beta Tool'),
    ])

    render(<PluginsPanel />)

    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-detail-panel')).toHaveTextContent('beta-tool')

    fireEvent.click(screen.getByText('hide detail'))
    fireEvent.click(screen.getByText('refresh detail'))

    expect(mockSetCurrentPluginID).toHaveBeenCalledWith(undefined)
    expect(mockInvalidateInstalledPluginList).toHaveBeenCalled()
  })
})
