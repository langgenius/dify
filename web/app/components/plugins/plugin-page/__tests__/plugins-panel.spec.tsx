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
  useInstalledPluginList: () => mockUseInstalledPluginList(),
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
  default: ({ contentInset, variant }: { contentInset?: string, variant?: string }) => (
    <div data-testid="empty-state" data-content-inset={contentInset} data-variant={variant}>empty</div>
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

  it('uses the Figma trigger toolbar frame and renders the toolbar action', () => {
    render(
      <PluginsPanel
        contentInset="compact"
        fixedCategory={PluginCategoryEnum.trigger}
        toolbarAction={<button type="button">update setting</button>}
      />,
    )

    expect(screen.getByTestId('filter-management-wrap').parentElement).toHaveClass('h-12', 'py-2', 'max-w-[1600px]', 'px-6')
    expect(screen.getByText('update setting')).toBeInTheDocument()
  })

  it('uses the Figma agent strategy body without the filter toolbar', () => {
    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.agent} />)

    expect(screen.queryByTestId('filter-management')).not.toBeInTheDocument()
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-variant', 'integrationsAgentStrategy')
  })

  it('hides tag filtering UI for the extension integrations category', () => {
    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.extension} />)

    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-category-filter', 'true')
    expect(screen.getByTestId('filter-management')).toHaveAttribute('data-hide-tag-filter', 'true')
  })

  it('does not apply hidden tag filters outside the trigger integrations category', () => {
    mockState.filters.tags = ['search']
    mockPluginListWithLatestVersion.mockReturnValue([
      createPlugin('extension-plugin', 'Extension Plugin', ['rag'], PluginCategoryEnum.extension),
    ])

    render(<PluginsPanel contentInset="compact" fixedCategory={PluginCategoryEnum.extension} />)

    expect(screen.getByTestId('plugin-list')).toHaveTextContent('extension-plugin')
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
