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
import { createDeferred } from '@/test/deferred'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { PluginCategoryEnum } from '../../types'
import { PluginPageContext } from '../context'
import PluginsPanel from '../plugins-panel'

const requests = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.get': requests.list,
      'workspaces.current.plugin.byCategory.list.get': requests.list,
    }),
  }
})
// Marketplace version enrichment is independent of installed-list pagination and filtering.
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
): ReturnType<typeof createPluginEntity> => {
  const base = createPluginEntity()
  return {
    ...base,
    id: pluginId,
    plugin_id: pluginId,
    plugin_unique_identifier: `${pluginId}-uid`,
    declaration: {
      ...base.declaration,
      name: pluginId,
      category,
      label: { en_US: label },
      description: { en_US: `${label} description` },
      tags,
    },
  }
}

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

let plugins: ReturnType<typeof createPluginEntity>[]
let builtinTools: Collection[]
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
const renderPanel = async (
  props: ComponentProps<typeof PluginsPanel> = {},
  filters = initialFilters,
  marketplace = true,
  selection?: PluginPageSelection,
) => {
  const result = renderWithConsoleQuery(
    <Harness filters={filters} selection={selection}>
      <PluginsPanel {...props} />
    </Harness>,
    { systemFeatures: { enable_marketplace: marketplace } },
  )
  await waitFor(() => expect(result.queryClient.isFetching()).toBe(0))
  return result
}

const pluginButton = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  plugins = []
  builtinTools = []
  observers.length = 0
  requests.list.mockReset().mockImplementation(async () => ({
    plugins,
    builtin_tools: builtinTools,
    total: plugins.length,
    has_more: false,
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
  it('shows loading before exposing installed results', async () => {
    const request = createDeferred<{
      plugins: ReturnType<typeof createPluginEntity>[]
      total: number
    }>()
    requests.list.mockReturnValue(request.promise)
    const rendered = renderPanel()
    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByText('plugin.list.noInstalled')).not.toBeInTheDocument()
    await act(async () => request.resolve({ plugins: [], total: 0 }))
    await rendered
  })

  it('locks the fixed category while retaining tag filters and toolbar actions', async () => {
    plugins = [
      createPlugin('trigger', 'Trigger Plugin', [], PluginCategoryEnum.trigger),
      createPlugin('tool', 'Tool Plugin'),
    ]
    await renderPanel({
      fixedCategory: PluginCategoryEnum.trigger,
      toolbarAction: <button>Update settings</button>,
    })
    expect(pluginButton('Trigger Plugin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tool Plugin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin.allCategories' })).not.toBeInTheDocument()
    expect(pluginButton('common.tag.tags')).toBeInTheDocument()
    expect(pluginButton('Update settings')).toBeInTheDocument()
    expect(requests.list).toHaveBeenCalledWith({
      params: { category: PluginCategoryEnum.trigger },
      query: { page: 1, page_size: 30, language: 'en_US' },
    })
  })

  it('applies tag filters to both installed tools and the marketplace handoff', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    plugins = [
      createPlugin('search-plugin', 'Search Plugin', ['search']),
      createPlugin('rag-plugin', 'Rag Plugin', ['rag']),
    ]
    builtinTools = [
      createBuiltinTool('search-builtin', 'Search Builtin', ['search']),
      createBuiltinTool('rag-builtin', 'Rag Builtin', ['rag']),
    ]
    await renderPanel({ fixedCategory: PluginCategoryEnum.tool })
    await user.click(pluginButton('common.tag.tags'))
    await user.click(await screen.findByRole('checkbox', { name: 'pluginTags.tags.search' }))
    await user.keyboard('{Escape}')
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(await screen.findByRole('button', { name: 'Search Plugin' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Rag Plugin' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Search Builtin/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rag Builtin/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tool marketplace' })).toHaveTextContent('search')
    expect(requests.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ tags: ['search'] }) }),
    )
  })

  it('switches between builtin and installed plugin details and clears the selection when closed', async () => {
    const user = userEvent.setup()
    plugins = [createPlugin('tool-plugin', 'Tool Plugin')]
    builtinTools = [createBuiltinTool('builtin-tool', 'Builtin Tool')]
    await renderPanel({ fixedCategory: PluginCategoryEnum.tool })
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
    plugins = [createPlugin('tool-plugin', 'Updated Plugin')]
    await user.click(pluginButton('Refresh plugin details'))
    expect(await screen.findByRole('button', { name: 'Updated Plugin' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Tool Plugin' })).not.toBeInTheDocument()
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
    async ({ category, empty, target, supportsTags }) => {
      await renderPanel({ fixedCategory: category, canInstall: false })
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
    async (category) => {
      await renderPanel({ fixedCategory: category }, initialFilters, false)
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
    async (category) => {
      plugins = [
        createPlugin('rag', 'Rag Plugin', ['rag'], category),
        createPlugin('search', 'Search Plugin', ['search'], category),
      ]
      await renderPanel({ fixedCategory: category }, { ...initialFilters, tags: ['search'] })
      expect(pluginButton('Rag Plugin')).toBeInTheDocument()
      expect(pluginButton('Search Plugin')).toBeInTheDocument()
      expect(requests.list).toHaveBeenCalledWith(
        expect.objectContaining({ query: { page: 1, page_size: 30, language: 'en_US' } }),
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
    await renderPanel({ fixedCategory: PluginCategoryEnum.tool })
    await user.type(screen.getByRole('searchbox', { name: 'plugin.search' }), 'beta')
    expect(pluginButton('Alpha Plugin')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(await screen.findByRole('button', { name: 'Beta Plugin' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Alpha Plugin' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beta Builtin/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Alpha Builtin/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tool marketplace' })).toHaveTextContent('beta')
  })

  it('offers manual pagination on the standalone plugin page and appends the returned cards', async () => {
    const user = userEvent.setup()
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      createPlugin(`tool-${index}`, `Tool ${index}`),
    )
    requests.list
      .mockResolvedValueOnce({ plugins: firstPage, total: 101 })
      .mockResolvedValueOnce({ plugins: [createPlugin('last-tool', 'Last Tool')], total: 101 })
    await renderPanel()
    await user.click(pluginButton('workflow.common.loadMore'))
    expect(await screen.findByRole('button', { name: 'Last Tool' })).toBeVisible()
    expect(pluginButton('Tool 0')).toBeVisible()
    expect(pluginButton('Tool 99')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'workflow.common.loadMore' }),
    ).not.toBeInTheDocument()
    expect(requests.list).toHaveBeenLastCalledWith({ query: { page: 2, page_size: 100 } })
  })

  it('loads another integration page once per intersection and announces pagination without replacing the status', async () => {
    const nextPage = createDeferred<{
      plugins: ReturnType<typeof createPluginEntity>[]
      has_more: boolean
    }>()
    const firstPage = Array.from({ length: 30 }, (_, index) =>
      createPlugin(`tool-${index}`, `Tool ${index}`),
    )
    requests.list
      .mockResolvedValueOnce({ plugins: firstPage, has_more: true })
      .mockReturnValueOnce(nextPage.promise)
    await renderPanel({ fixedCategory: PluginCategoryEnum.tool })
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
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('common.loading'))
    expect(screen.getByRole('status')).toBe(status)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-live')
    expect(requests.list).toHaveBeenCalledTimes(2)
    expect(requests.list).toHaveBeenLastCalledWith({
      params: { category: PluginCategoryEnum.tool },
      query: { page: 2, page_size: 30, language: 'en_US' },
    })
    await act(async () =>
      nextPage.resolve({ plugins: [createPlugin('last-tool', 'Last Tool')], has_more: false }),
    )
    expect(await screen.findByRole('button', { name: 'Last Tool' })).toBeVisible()
    expect(pluginButton('Tool 0')).toBeVisible()
    expect(pluginButton('Tool 29')).toBeVisible()
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('plugin.marketplace.pluginsResult')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('preserves the selected plugin details when filtering hides its card', async () => {
    const user = userEvent.setup()
    plugins = [createPlugin('tool-plugin', 'Tool Plugin')]
    await renderPanel({}, { ...initialFilters, searchQuery: 'missing' }, true, {
      type: 'plugin',
      id: 'tool-plugin',
    })
    expect(screen.getByText('plugin.list.notFound')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tool Plugin' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Plugin details' })).toHaveTextContent('tool-plugin')
    await user.click(pluginButton('Close plugin details'))
    expect(screen.queryByRole('region', { name: 'Plugin details' })).not.toBeInTheDocument()
  })

  it('keeps category marketplace search available without presenting a no-installation prompt for unmatched searches', async () => {
    plugins = [createPlugin('trigger', 'Trigger Plugin', [], PluginCategoryEnum.trigger)]
    await renderPanel(
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
