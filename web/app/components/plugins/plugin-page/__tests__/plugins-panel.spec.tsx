import type { PluginDetail } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
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
  default: ({ pluginList }: { pluginList: PluginDetail[] }) => <div data-testid="plugin-list">{pluginList.map(plugin => plugin.plugin_id).join(',')}</div>,
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

    expect(screen.getByRole('status')).toBeInTheDocument()
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

  it('refetches installed plugins whenever an integrations category panel mounts', () => {
    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.trigger} />)

    expect(mockUseInstalledPluginList).toHaveBeenCalledWith(undefined, 100, { refetchOnMount: 'always' })
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
