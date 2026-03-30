import type { PluginDeclaration, PluginDetail } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { PluginCategoryEnum, PluginSource } from '../../types'

import PluginsPanel from '../plugins-panel'

const {
  mockSetFilters,
  mockSetCurrentPluginID,
  mockLoadNextPage,
  mockInvalidateInstalledPluginList,
} = vi.hoisted(() => ({
  mockSetFilters: vi.fn(),
  mockSetCurrentPluginID: vi.fn(),
  mockLoadNextPage: vi.fn(),
  mockInvalidateInstalledPluginList: vi.fn(),
}))

type PluginPageContextState = {
  filters: {
    categories: string[]
    tags: string[]
    searchQuery: string
  }
  setFilters: (filters: {
    categories: string[]
    tags: string[]
    searchQuery: string
  }) => void
  currentPluginID: string | undefined
  setCurrentPluginID: (pluginID?: string) => void
}

let mockContextState: PluginPageContextState
let mockPluginList: PluginDetail[]
let mockPluginListLoading = false
let mockPluginListFetching = false
let mockIsLastPage = true

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (...args: unknown[]) => void) => ({
    run: fn,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

vi.mock('@/i18n-config', () => ({
  renderI18nObject: (value: Record<string, string> | undefined, locale: string) =>
    value?.[locale] ?? value?.['en-US'] ?? '',
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({
    data: { plugins: mockPluginList },
    isLoading: mockPluginListLoading,
    isFetching: mockPluginListFetching,
    isLastPage: mockIsLastPage,
    loadNextPage: mockLoadNextPage,
  }),
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

vi.mock('../../hooks', () => ({
  usePluginsWithLatestVersion: (plugins: PluginDetail[] | undefined) => plugins ?? [],
}))

vi.mock('../context', () => ({
  usePluginPageContext: (selector: (value: PluginPageContextState) => unknown) => selector(mockContextState),
}))

vi.mock('../filter-management', () => ({
  default: ({ onFilterChange }: {
    onFilterChange: (filters: {
      categories: string[]
      tags: string[]
      searchQuery: string
    }) => void
  }) => (
    <button
      data-testid="filter-management"
      onClick={() => onFilterChange({
        categories: ['tool'],
        tags: ['featured'],
        searchQuery: 'needle',
      })}
    >
      filter
    </button>
  ),
}))

vi.mock('../list', () => ({
  default: ({ pluginList }: { pluginList: PluginDetail[] }) => (
    <div data-testid="plugin-list">
      {pluginList.map(plugin => plugin.plugin_id).join(',')}
    </div>
  ),
}))

vi.mock('../empty', () => ({
  default: () => <div data-testid="empty">empty</div>,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: ({ className, type }: { className?: string, type?: string }) => (
    <div data-testid="loading" data-class-name={className} data-type={type}>loading</div>
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({
    detail,
    onUpdate,
    onHide,
  }: {
    detail?: PluginDetail
    onUpdate: () => void
    onHide: () => void
  }) => (
    <div data-testid="plugin-detail-panel">
      <span data-testid="plugin-detail-id">{detail?.plugin_id ?? 'none'}</span>
      <button data-testid="plugin-detail-update" onClick={onUpdate}>update</button>
      <button data-testid="plugin-detail-hide" onClick={onHide}>hide</button>
    </div>
  ),
}))

const createPluginDeclaration = (overrides: Partial<PluginDeclaration> = {}): PluginDeclaration => ({
  plugin_unique_identifier: 'plugin.unique',
  version: '1.0.0',
  author: 'Plugin Author',
  icon: 'icon',
  name: 'Declaration Name',
  category: PluginCategoryEnum.tool,
  label: { 'en-US': 'Label Text' } as PluginDeclaration['label'],
  description: { 'en-US': 'Description Text' } as PluginDeclaration['description'],
  created_at: '2024-01-01T00:00:00Z',
  resource: {} as PluginDeclaration['resource'],
  plugins: {} as PluginDeclaration['plugins'],
  verified: false,
  endpoint: { settings: [], endpoints: [] },
  tool: undefined,
  datasource: undefined,
  model: {} as PluginDeclaration['model'],
  tags: ['featured'],
  agent_strategy: {} as PluginDeclaration['agent_strategy'],
  meta: { version: '1.0.0' },
  trigger: {} as PluginDeclaration['trigger'],
  ...overrides,
})

const createPlugin = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-id',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  name: 'Plugin Name',
  plugin_id: 'plugin.id',
  plugin_unique_identifier: 'plugin.unique',
  declaration: createPluginDeclaration(),
  installation_id: 'installation-id',
  tenant_id: 'tenant-id',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.1',
  latest_unique_identifier: 'plugin.unique@1.0.1',
  source: PluginSource.marketplace,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

describe('PluginsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockContextState = {
      filters: {
        categories: [],
        tags: [],
        searchQuery: '',
      },
      setFilters: mockSetFilters,
      currentPluginID: undefined,
      setCurrentPluginID: mockSetCurrentPluginID,
    }
    mockPluginList = [createPlugin()]
    mockPluginListLoading = false
    mockPluginListFetching = false
    mockIsLastPage = true
  })

  it('should render loading while the plugin list is loading', () => {
    mockPluginListLoading = true

    render(<PluginsPanel />)

    expect(screen.getByTestId('loading')).toHaveAttribute('data-type', 'app')
    expect(screen.getByTestId('plugin-detail-id')).toHaveTextContent('none')
  })

  it('should update filters through the debounced callback', () => {
    render(<PluginsPanel />)

    fireEvent.click(screen.getByTestId('filter-management'))

    expect(mockSetFilters).toHaveBeenCalledWith({
      categories: ['tool'],
      tags: ['featured'],
      searchQuery: 'needle',
    })
  })

  it('should filter plugins by category and tag', () => {
    mockContextState.filters = {
      categories: ['tool'],
      tags: ['featured'],
      searchQuery: '',
    }

    render(<PluginsPanel />)

    expect(screen.getByTestId('plugin-list')).toHaveTextContent('plugin.id')
  })

  it('should filter plugins by plugin id', () => {
    const plugin = createPlugin({
      plugin_id: 'needle-id',
      name: 'Plugin Name',
      declaration: createPluginDeclaration({
        name: 'Declaration Name',
        label: { 'en-US': 'Label Text' } as PluginDeclaration['label'],
        description: { 'en-US': 'Description Text' } as PluginDeclaration['description'],
      }),
    })

    mockPluginList = [plugin]
    mockContextState.filters = {
      categories: [],
      tags: [],
      searchQuery: 'needle-id',
    }

    render(<PluginsPanel />)

    expect(screen.getByTestId('plugin-list')).toHaveTextContent('needle-id')
  })

  it('should filter plugins by plugin name, declaration name, label, and description', () => {
    const plugin = createPlugin({
      plugin_id: 'plugin-id',
      name: 'Needle Name',
      declaration: createPluginDeclaration({
        name: 'Needle Declaration',
        label: { 'en-US': 'Needle Label' } as PluginDeclaration['label'],
        description: { 'en-US': 'Needle Description' } as PluginDeclaration['description'],
      }),
    })

    mockPluginList = [plugin]
    const { rerender } = render(<PluginsPanel />)

    mockContextState.filters = {
      categories: [],
      tags: [],
      searchQuery: 'needle name',
    }
    rerender(<PluginsPanel />)
    expect(screen.getByTestId('plugin-list')).toHaveTextContent('plugin-id')

    mockContextState.filters = {
      categories: [],
      tags: [],
      searchQuery: 'needle declaration',
    }
    rerender(<PluginsPanel />)
    expect(screen.getByTestId('plugin-list')).toHaveTextContent('plugin-id')

    mockContextState.filters = {
      categories: [],
      tags: [],
      searchQuery: 'needle label',
    }
    rerender(<PluginsPanel />)
    expect(screen.getByTestId('plugin-list')).toHaveTextContent('plugin-id')

    mockContextState.filters = {
      categories: [],
      tags: [],
      searchQuery: 'needle description',
    }
    rerender(<PluginsPanel />)
    expect(screen.getByTestId('plugin-list')).toHaveTextContent('plugin-id')
  })

  it('should render empty state when no plugin matches the filters', () => {
    mockContextState.filters = {
      categories: ['model'],
      tags: [],
      searchQuery: '',
    }

    render(<PluginsPanel />)

    expect(screen.getByTestId('empty')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-list')).not.toBeInTheDocument()
  })

  it('should render empty state when the search query does not match any plugin field', () => {
    mockContextState.filters = {
      categories: [],
      tags: [],
      searchQuery: 'missing-value',
    }

    render(<PluginsPanel />)

    expect(screen.getByTestId('empty')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-list')).not.toBeInTheDocument()
  })

  it('should render a load more button and request the next page', () => {
    mockIsLastPage = false

    render(<PluginsPanel />)

    fireEvent.click(screen.getByText('common.loadMore'))

    expect(mockLoadNextPage).toHaveBeenCalledTimes(1)
  })

  it('should render the inline loader when fetching more items', () => {
    mockIsLastPage = false
    mockPluginListFetching = true

    render(<PluginsPanel />)

    expect(screen.getByTestId('loading')).toHaveAttribute('data-class-name', 'size-8')
    expect(screen.queryByText('common.loadMore')).not.toBeInTheDocument()
  })

  it('should pass the selected plugin to the detail panel and handle its callbacks', () => {
    mockContextState.currentPluginID = 'plugin.id'

    render(<PluginsPanel />)

    expect(screen.getByTestId('plugin-detail-id')).toHaveTextContent('plugin.id')

    fireEvent.click(screen.getByTestId('plugin-detail-update'))
    fireEvent.click(screen.getByTestId('plugin-detail-hide'))

    expect(mockInvalidateInstalledPluginList).toHaveBeenCalledTimes(1)
    expect(mockSetCurrentPluginID).toHaveBeenCalledWith(undefined)
  })
})
