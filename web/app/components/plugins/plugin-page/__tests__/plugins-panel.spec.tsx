import type { PluginDetail } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  default: ({ onFilterChange }: { onFilterChange: (filters: typeof mockState.filters) => void }) => (
    <button
      data-testid="filter-management"
      onClick={() => onFilterChange({
        categories: [],
        tags: [],
        searchQuery: 'beta',
      })}
    >
      filter
    </button>
  ),
}))

vi.mock('../empty', () => ({
  default: () => <div data-testid="empty-state">empty</div>,
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

const createPlugin = (pluginId: string, label: string, tags: string[] = []): PluginDetail => ({
  id: pluginId,
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: label,
  plugin_id: pluginId,
  plugin_unique_identifier: `${pluginId}-uid`,
  declaration: {
    category: 'tool',
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
