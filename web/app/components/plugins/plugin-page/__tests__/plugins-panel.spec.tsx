import type { ComponentProps, ReactNode } from 'react'
import type { PluginDetail } from '../../types'
import type { PluginPageSelection } from '../context'
import type { FilterState } from '../filter-management'
import type { Collection } from '@/app/components/tools/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { PluginCategoryEnum } from '../../types'
import { PluginPageContext } from '../context'
import PluginsPanel from '../plugins-panel'

const requests = vi.hoisted(() => ({ list: vi.fn(), invalidate: vi.fn(), nextPage: vi.fn() }))
// Service pagination and marketplace enrichment are tested by their own owners.
// This suite exercises list filtering, selection and pagination controls with real cards.
vi.mock('@/service/use-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-plugins')>()),
  useInstalledPluginList: (...args: unknown[]) => requests.list(...args),
  useInvalidateInstalledPluginList: () => requests.invalidate,
  useRemoveFilteredInstalledPluginPageOnUnmount: () => {},
}))
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  usePluginsWithLatestVersion: (plugins: PluginDetail[] = []) => plugins,
}))
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({ setShowUpdatePluginModal: vi.fn() }),
}))
vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))

// Detail editors and marketplace catalogs are independently tested feature boundaries.
vi.mock('@/app/components/tools/provider/detail', () => ({
  default: ({ collection, onHide }: { collection: Collection; onHide: () => void }) => (
    <section aria-label="Builtin tool details">
      <span>{collection.id}</span>
      <button onClick={onHide}>Close builtin details</button>
    </section>
  ),
}))
vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({
    detail,
    onHide,
    onUpdate,
  }: {
    detail?: PluginDetail
    onHide: () => void
    onUpdate: () => void
  }) =>
    detail ? (
      <section aria-label="Plugin details">
        <span>{detail.plugin_id}</span>
        <button onClick={onHide}>Close plugin details</button>
        <button onClick={onUpdate}>Refresh plugin details</button>
      </section>
    ) : null,
}))
vi.mock('@/app/components/tools/marketplace/builtin-marketplace-panel', () => ({
  BuiltinMarketplacePanel: ({
    keywords,
    tagFilterValue,
  }: {
    keywords: string
    tagFilterValue: string[]
  }) => (
    <section aria-label="Tool marketplace">
      {keywords} {tagFilterValue.join(',')}
    </section>
  ),
}))
vi.mock('../category-marketplace-panel', () => ({
  default: ({
    category,
    searchText,
    tags,
  }: {
    category: string
    searchText: string
    tags: string[]
  }) => (
    <section aria-label={`${category} marketplace`}>
      {searchText} {tags.join(',')}
    </section>
  ),
}))

const createPlugin = (
  pluginId: string,
  label: string,
  tags: string[] = [],
  category: PluginCategoryEnum = PluginCategoryEnum.tool,
): PluginDetail =>
  ({
    id: pluginId,
    created_at: '2024-01-01',
    updated_at: '2024-01-02',
    name: label,
    plugin_id: pluginId,
    plugin_unique_identifier: `${pluginId}-uid`,
    declaration: {
      category,
      author: 'test-author',
      icon: 'https://example.com/plugin.png',
      meta: { version: '1.0.0', minimum_dify_version: '0.0.0' },
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

let plugins: PluginDetail[]
let builtinTools: Collection[]
let fetching: boolean
let loading: boolean
let lastPage: boolean
const observers: IntersectionObserverCallback[] = []
const initialFilters: FilterState = { categories: [], tags: [], searchQuery: '' }
function Harness({
  children,
  filters: initial = initialFilters,
  selection,
}: {
  children: ReactNode
  filters?: FilterState
  selection?: PluginPageSelection
}) {
  const [filters, setFilters] = useState(initial)
  const [selectedItem, setSelectedItem] = useState(selection)
  return (
    <PluginPageContext.Provider
      value={{
        containerRef: { current: null },
        filters,
        setFilters,
        selectedItem,
        setSelectedItem,
        activeTab: 'plugins',
        setActiveTab: () => {},
        options: [],
      }}
    >
      {children}
    </PluginPageContext.Provider>
  )
}
const renderPanel = (
  props: ComponentProps<typeof PluginsPanel> = {},
  filters = initialFilters,
  marketplace = true,
  selection?: PluginPageSelection,
) =>
  renderWithConsoleQuery(
    <Harness filters={filters} selection={selection}>
      <PluginsPanel {...props} />
    </Harness>,
    { systemFeatures: { enable_marketplace: marketplace } },
  )
const pluginButton = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
  plugins = []
  builtinTools = []
  fetching = false
  loading = false
  lastPage = true
  observers.length = 0
  requests.list.mockImplementation(() => ({
    data: { plugins, builtin_tools: builtinTools },
    isLoading: loading,
    isFetching: fetching,
    isLastPage: lastPage,
    loadNextPage: requests.nextPage,
  }))
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback)
      }
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Plugin list panel', () => {
  it('shows loading before exposing installed results', () => {
    loading = true
    renderPanel()
    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByText('plugin.list.noInstalled')).not.toBeInTheDocument()
  })

  it('locks the fixed category while retaining tag filters and toolbar actions', () => {
    plugins = [
      createPlugin('trigger', 'Trigger Plugin', [], PluginCategoryEnum.trigger),
      createPlugin('tool', 'Tool Plugin'),
    ]
    renderPanel({
      fixedCategory: PluginCategoryEnum.trigger,
      toolbarAction: <button>Update settings</button>,
    })
    expect(pluginButton('Trigger Plugin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tool Plugin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin.allCategories' })).not.toBeInTheDocument()
    expect(pluginButton('common.tag.tags')).toBeInTheDocument()
    expect(pluginButton('Update settings')).toBeInTheDocument()
    expect(requests.list).toHaveBeenCalledWith(
      expect.objectContaining({ category: PluginCategoryEnum.trigger, pageSize: 30 }),
    )
  })

  it('applies tag filters to both installed tools and the marketplace handoff', async () => {
    const user = userEvent.setup()
    plugins = [
      createPlugin('search-plugin', 'Search Plugin', ['search']),
      createPlugin('rag-plugin', 'Rag Plugin', ['rag']),
    ]
    builtinTools = [
      createBuiltinTool('search-builtin', 'Search Builtin', ['search']),
      createBuiltinTool('rag-builtin', 'Rag Builtin', ['rag']),
    ]
    renderPanel({ fixedCategory: PluginCategoryEnum.tool })
    await user.click(pluginButton('common.tag.tags'))
    await user.click(await screen.findByRole('checkbox', { name: 'pluginTags.tags.search' }))
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Rag Plugin' })).not.toBeInTheDocument(),
    )
    expect(pluginButton('Search Plugin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Search Builtin/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rag Builtin/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tool marketplace' })).toHaveTextContent('search')
    expect(requests.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ tags: ['search'] }) }),
    )
  })

  it('switches between builtin and installed plugin details and clears the selection when closed', async () => {
    const user = userEvent.setup()
    plugins = [createPlugin('tool-plugin', 'Tool Plugin')]
    builtinTools = [createBuiltinTool('builtin-tool', 'Builtin Tool')]
    renderPanel({ fixedCategory: PluginCategoryEnum.tool })
    const builtin = screen.getByRole('button', { name: /Builtin Tool/ })
    await user.click(builtin)
    expect(builtin).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('region', { name: 'Builtin tool details' })).toHaveTextContent(
      'builtin-tool',
    )
    await user.click(pluginButton('Tool Plugin'))
    expect(screen.getByRole('region', { name: 'Plugin details' })).toHaveTextContent('tool-plugin')
    expect(screen.queryByRole('region', { name: 'Builtin tool details' })).not.toBeInTheDocument()
    expect(builtin).not.toHaveAttribute('aria-current')
    await user.click(pluginButton('Refresh plugin details'))
    expect(requests.invalidate).toHaveBeenCalledWith(PluginCategoryEnum.tool)
    await user.click(pluginButton('Close plugin details'))
    expect(screen.queryByRole('region', { name: 'Plugin details' })).not.toBeInTheDocument()
  })

  it.each([
    {
      category: PluginCategoryEnum.trigger,
      empty: 'noTriggerFound',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationTriggerGrid,
      supportsTags: true,
    },
    {
      category: PluginCategoryEnum.agent,
      empty: 'noAgentStrategyFound',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationAgentStrategyEmpty,
      supportsTags: false,
    },
    {
      category: PluginCategoryEnum.extension,
      empty: 'noExtensionFound',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationExtensionGrid,
      supportsTags: false,
    },
  ])(
    'keeps the $category catalog browsable without install permission and hides unsupported filters',
    ({ category, empty, target, supportsTags }) => {
      renderPanel({ fixedCategory: category, canInstall: false })
      expect(screen.getByText(`plugin.list.${empty}`)).toBeInTheDocument()
      expect(screen.getByRole('region', { name: `${category} marketplace` })).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'plugin.marketplace.difyMarketplace' }),
      ).toHaveAttribute('href', `#plugin-category-marketplace-${category}`)
      expect(screen.queryByRole('button', { name: 'plugin.allCategories' })).not.toBeInTheDocument()
      expect(!!screen.queryByRole('button', { name: 'common.tag.tags' })).toBe(supportsTags)
      expect(document.querySelector(getStepByStepTourTargetSelector(target))).toContainElement(
        screen.getByText(`plugin.list.${empty}`),
      )
    },
  )

  it.each([PluginCategoryEnum.trigger, PluginCategoryEnum.agent, PluginCategoryEnum.extension])(
    'omits %s marketplace navigation when disabled',
    (category) => {
      renderPanel({ fixedCategory: category }, initialFilters, false)
      expect(
        screen.queryByRole('region', { name: `${category} marketplace` }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'plugin.marketplace.difyMarketplace' }),
      ).not.toBeInTheDocument()
    },
  )

  it.each([PluginCategoryEnum.agent, PluginCategoryEnum.extension])(
    'ignores hidden tag filters for %s in both local results and service requests',
    (category) => {
      plugins = [
        createPlugin('rag', 'Rag Plugin', ['rag'], category),
        createPlugin('search', 'Search Plugin', ['search'], category),
      ]
      renderPanel({ fixedCategory: category }, { ...initialFilters, tags: ['search'] })
      expect(pluginButton('Rag Plugin')).toBeInTheDocument()
      expect(pluginButton('Search Plugin')).toBeInTheDocument()
      expect(requests.list).toHaveBeenCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ tags: [] }) }),
      )
      expect(screen.getByRole('region', { name: `${category} marketplace` })).not.toHaveTextContent(
        'search',
      )
    },
  )

  it('debounces search changes and filters installed and builtin tools while forwarding marketplace search', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    plugins = [
      createPlugin('alpha-plugin', 'Alpha Plugin'),
      createPlugin('beta-plugin', 'Beta Plugin'),
    ]
    builtinTools = [
      createBuiltinTool('alpha-builtin', 'Alpha Builtin'),
      createBuiltinTool('beta-builtin', 'Beta Builtin'),
    ]
    renderPanel({ fixedCategory: PluginCategoryEnum.tool })
    await user.type(screen.getByRole('searchbox', { name: 'plugin.search' }), 'beta')
    expect(pluginButton('Alpha Plugin')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.queryByRole('button', { name: 'Alpha Plugin' })).not.toBeInTheDocument()
    expect(pluginButton('Beta Plugin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beta Builtin/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Alpha Builtin/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tool marketplace' })).toHaveTextContent('beta')
  })

  it('offers manual pagination on the standalone plugin page', async () => {
    const user = userEvent.setup()
    plugins = [createPlugin('tool', 'Tool Plugin')]
    lastPage = false
    renderPanel()
    await user.click(pluginButton('workflow.common.loadMore'))
    expect(requests.nextPage).toHaveBeenCalledOnce()
    expect(observers).toHaveLength(0)
  })

  it('loads another integration page once per intersection and announces pagination without replacing the status', () => {
    plugins = [createPlugin('tool', 'Tool Plugin')]
    lastPage = false
    const { rerender } = renderPanel({ fixedCategory: PluginCategoryEnum.tool })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('plugin.marketplace.pluginsResult')
    const intersect = () =>
      observers[0]!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    act(() => {
      intersect()
      intersect()
    })
    expect(requests.nextPage).toHaveBeenCalledOnce()
    fetching = true
    rerender(
      <Harness>
        <PluginsPanel fixedCategory={PluginCategoryEnum.tool} />
      </Harness>,
    )
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('common.loading')
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-live')
    expect(observers).toHaveLength(1)
    fetching = false
    lastPage = true
    rerender(
      <Harness>
        <PluginsPanel fixedCategory={PluginCategoryEnum.tool} />
      </Harness>,
    )
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('plugin.marketplace.pluginsResult')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(observers).toHaveLength(1)
  })

  it('preserves the selected plugin details when filtering hides its card', async () => {
    const user = userEvent.setup()
    plugins = [createPlugin('tool-plugin', 'Tool Plugin')]
    renderPanel({}, { ...initialFilters, searchQuery: 'missing' }, true, {
      type: 'plugin',
      id: 'tool-plugin',
    })
    expect(screen.getByText('plugin.list.notFound')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tool Plugin' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Plugin details' })).toHaveTextContent('tool-plugin')
    await user.click(pluginButton('Close plugin details'))
    expect(screen.queryByRole('region', { name: 'Plugin details' })).not.toBeInTheDocument()
  })

  it('keeps category marketplace search available without presenting a no-installation prompt for unmatched searches', () => {
    plugins = [createPlugin('trigger', 'Trigger Plugin', [], PluginCategoryEnum.trigger)]
    renderPanel(
      { fixedCategory: PluginCategoryEnum.trigger },
      { ...initialFilters, searchQuery: 'missing' },
    )
    expect(screen.queryByRole('button', { name: 'Trigger Plugin' })).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.list.noTriggerFound')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.list.noInstalled')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'trigger marketplace' })).toHaveTextContent('missing')
  })
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock, withSelectorKeyProps } = await import('@/test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock(),
    Trans: withSelectorKeyProps(
      ({ i18nKey, components }: { i18nKey: string; components?: Record<string, ReactNode> }) => (
        <span>
          {i18nKey}
          {components?.marketplace}
        </span>
      ),
    ),
  }
})
