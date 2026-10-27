import type { ReactElement, ReactNode } from 'react'
import type { PluginDeclaration, PluginDetail } from '../../types'
import { useQuery } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { consoleQuery } from '@/service/console'
import { useInstalledPluginList } from '@/service/use-plugins'
import { createCatalogModelFixture, createModelCatalogFixture } from '@/test/console/model-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { PluginPageContext } from '../../plugin-page/context'
import { PluginCategoryEnum, PluginSource } from '../../types'
import PluginItem from '../index'

const mockEnableMarketplace = vi.fn(() => true)

const mockTheme = vi.fn(() => 'light')
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme() }),
}))
const PluginPageContextProvider = PluginPageContext.Provider

const mockLangGeniusVersionInfo = vi.fn(() => ({
  current_env: '',
  current_version: '1.0.0',
  latest_version: '',
  release_notes: '',
  version: '',
}))

const createLangGeniusVersionInfo = (currentVersion: string) => ({
  current_env: '',
  current_version: currentVersion,
  latest_version: '',
  release_notes: '',
  version: '',
})

function PluginPageBoundary({ children }: { children: ReactNode }) {
  const [selectedItem, setSelectedItem] = useState<
    { type: 'plugin'; id: string } | { type: 'builtinTool'; id: string }
  >()
  return (
    <PluginPageContextProvider
      value={{
        containerRef: { current: null },
        selectedItem,
        setSelectedItem,
        filters: { categories: [], tags: [], searchQuery: '' },
        setFilters: () => {},
        activeTab: 'plugins',
        setActiveTab: () => {},
        options: [],
      }}
    >
      <output aria-label="selected plugin">
        {selectedItem ? `${selectedItem.type}:${selectedItem.id}` : 'none'}
      </output>
      {children}
    </PluginPageContextProvider>
  )
}

const render = (ui: ReactElement) => {
  const wrap = (element: ReactElement) => (
    <PluginPageBoundary>
      <ModalContextProvider>{element}</ModalContextProvider>
    </PluginPageBoundary>
  )
  const rendered = renderWithConsoleQuery(wrap(ui), {
    accountProfileMeta: {
      currentVersion: mockLangGeniusVersionInfo().current_version,
    },
    systemFeatures: { enable_marketplace: mockEnableMarketplace() },
  })
  return { ...rendered, rerender: (element: ReactElement) => rendered.rerender(wrap(element)) }
}

const requests = vi.hoisted(() => ({
  categoryList: vi.fn(),
  models: vi.fn(),
  uninstall: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.byCategory.list.get': requests.categoryList,
      'workspaces.current.models.modelTypes.byModelType.get': requests.models,
    }),
  }
})
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uninstallPlugin: requests.uninstall,
}))

const createPluginDeclaration = (
  overrides: Partial<PluginDeclaration> = {},
): PluginDeclaration => ({
  plugin_unique_identifier: 'test-plugin-id',
  version: '1.0.0',
  author: 'test-author',
  icon: 'test-icon.png',
  icon_dark: 'test-icon-dark.png',
  name: 'test-plugin',
  category: PluginCategoryEnum.tool,
  label: { en_US: 'Test Plugin' } as unknown as PluginDeclaration['label'],
  description: { en_US: 'Test plugin description' } as unknown as PluginDeclaration['description'],
  created_at: '2024-01-01',
  resource: null,
  plugins: null,
  verified: false,
  endpoint: undefined as PluginDeclaration['endpoint'],
  model: null,
  tags: [],
  agent_strategy: null,
  meta: {
    version: '1.0.0',
    minimum_dify_version: '0.5.0',
  },
  trigger: {} as unknown as PluginDeclaration['trigger'],
  ...overrides,
})

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  name: 'test-plugin',
  plugin_id: 'plugin-1',
  plugin_unique_identifier: 'test-author/test-plugin@1.0.0',
  declaration: createPluginDeclaration(),
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-author/test-plugin@1.0.0',
  source: PluginSource.marketplace,
  meta: {
    repo: 'test-author/test-plugin',
    version: '1.0.0',
    package: 'test-plugin.difypkg',
  },
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

let installedPlugins: ReturnType<typeof createPluginEntity>[] = []
let modelCatalog: ReturnType<typeof createModelCatalogFixture>[] = []

function InstalledPluginList({ category }: { category: PluginCategoryEnum }) {
  const { data } = useInstalledPluginList({ category, staleTime: 0 })
  const plugins = data?.plugins ?? []

  return (
    <output aria-label="installed plugin ids">
      {plugins.map((plugin) => plugin.plugin_id).join(',') || 'none'}
    </output>
  )
}

function ModelCatalog() {
  const { data = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) =>
        response.data.flatMap((provider) => provider.models.map((model) => model.model)),
    }),
  )

  return <output aria-label="model ids">{data.join(',') || 'none'}</output>
}

beforeEach(() => {
  vi.clearAllMocks()
  installedPlugins = []
  modelCatalog = []
  requests.categoryList.mockImplementation(async () => ({
    plugins: installedPlugins,
    builtin_tools: [],
    has_more: false,
  }))
  requests.models.mockImplementation(async () => ({ data: modelCatalog }))
  requests.uninstall.mockResolvedValue({ success: true })
  mockTheme.mockReturnValue('light')
  mockEnableMarketplace.mockReturnValue(true)
  mockLangGeniusVersionInfo.mockReturnValue(createLangGeniusVersionInfo('1.0.0'))
})

describe('Installed plugin card', () => {
  it.each([
    { source: PluginSource.github, label: 'GitHub', version: '1.5.0', author: true },
    { source: PluginSource.marketplace, label: 'marketplace', version: '2.0.0', author: true },
    { source: PluginSource.local, label: 'Local Plugin', version: '2.0.0', author: false },
    { source: PluginSource.debugging, label: 'Debugging Plugin', version: '2.0.0', author: false },
  ])(
    'shows the source and correct installed version for $source plugins',
    ({ source, label, version, author }) => {
      render(
        <PluginItem
          plugin={createPluginDetail({
            source,
            version: '2.0.0',
            meta: { repo: 'owner/repo', version: '1.5.0', package: 'pkg.difypkg' },
          })}
        />,
      )
      expect(screen.getByRole('button', { name: 'Test Plugin' })).toBeInTheDocument()
      expect(screen.getByText('Test plugin description')).toBeInTheDocument()
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText(version)).toBeInTheDocument()
      expect(!!screen.queryByText('test-author')).toBe(author)
      if (source === PluginSource.github)
        expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
          'href',
          'https://github.com/owner/repo',
        )
      else if (source === PluginSource.marketplace)
        expect(screen.getByRole('link', { name: /marketplace/ })).toHaveAttribute(
          'href',
          expect.stringContaining('/plugins/test-author/test-plugin'),
        )
      else expect(screen.queryByRole('link')).not.toBeInTheDocument()
    },
  )

  it('counts visible endpoint declarations independently of active endpoint instances', () => {
    render(
      <PluginItem
        plugin={createPluginDetail({
          declaration: createPluginDeclaration({
            endpoint: {
              settings: [],
              endpoints: [
                { path: '/first', method: 'POST' },
                { path: '/second', method: 'GET' },
                { path: '/hidden', method: 'GET', hidden: true },
              ],
            },
          }),
          endpoints_active: 0,
        })}
      />,
    )
    expect(screen.getByText('plugin.endpointsEnabled:{"num":2}')).toBeInTheDocument()
  })

  it.each(['0.3.0', '0.5.0', '1.0.0'])(
    'warns when Dify %s cannot run the installed plugin',
    (version) => {
      mockLangGeniusVersionInfo.mockReturnValue(createLangGeniusVersionInfo(version))
      render(<PluginItem plugin={createPluginDetail()} />)
      expect(!!screen.queryByRole('button', { name: /plugin.difyVersionNotCompatible/ })).toBe(
        version === '0.3.0',
      )
    },
  )

  it.each([
    { source: PluginSource.marketplace, enabled: true, expected: true },
    { source: PluginSource.marketplace, enabled: false, expected: false },
    { source: PluginSource.github, enabled: true, expected: false },
  ])(
    'reports withdrawal only for available marketplace entries: %j',
    ({ source, enabled, expected }) => {
      mockEnableMarketplace.mockReturnValue(enabled)
      const plugin = createPluginDetail({ source })
      const { rerender } = render(<PluginItem plugin={plugin} />)
      expect(screen.queryByText('plugin.deprecated')).not.toBeInTheDocument()
      rerender(
        <PluginItem
          plugin={{ ...plugin, status: 'deleted', deprecated_reason: 'No longer maintained' }}
        />,
      )
      expect(!!screen.queryByText('plugin.deprecated')).toBe(expected)
      if (!enabled)
        expect(screen.queryByRole('link', { name: /marketplace/ })).not.toBeInTheDocument()
    },
  )

  it('selects the plugin from the card and keeps its actions separate', async () => {
    const user = userEvent.setup()
    render(
      <>
        <section aria-label="Other plugin card">
          <PluginItem
            plugin={createPluginDetail({
              id: 'plugin-2',
              plugin_id: 'plugin-2',
              declaration: createPluginDeclaration({
                name: 'other-plugin',
                label: { en_US: 'Other Plugin' } as PluginDeclaration['label'],
              }),
            })}
          />
        </section>
        <section aria-label="Test plugin card">
          <PluginItem plugin={createPluginDetail()} />
        </section>
      </>,
    )
    const otherPlugin = within(screen.getByRole('region', { name: 'Other plugin card' }))
    const testPlugin = within(screen.getByRole('region', { name: 'Test plugin card' }))
    const otherCard = otherPlugin.getByRole('button', { name: 'Other Plugin' })
    await user.tab()
    expect(otherCard).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('status', { name: 'selected plugin' })).toHaveTextContent(
      'plugin:plugin-2',
    )
    const card = testPlugin.getByRole('button', { name: 'Test Plugin' })
    const action = testPlugin.getByRole('button', { name: 'plugin.action.delete' })
    expect(card).not.toContainElement(action)
    expect(card).not.toContainElement(testPlugin.getByRole('link', { name: /marketplace/ }))
    await user.click(action)
    expect(screen.getByRole('alertdialog', { name: 'plugin.action.delete' })).toHaveTextContent(
      'test-plugin',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.getByRole('status', { name: 'selected plugin' })).toHaveTextContent(
      'plugin:plugin-2',
    )
  })

  it('refreshes the visible plugin category after a real uninstall succeeds', async () => {
    const user = userEvent.setup()
    const installedModelPlugin = createPluginEntity({
      id: 'new-installation',
      installation_id: 'new-installation',
      plugin_id: 'plugin-1',
    })
    installedModelPlugin.declaration.author = 'test-author'
    installedModelPlugin.declaration.name = 'test-plugin'
    installedModelPlugin.declaration.category = PluginCategoryEnum.model
    installedModelPlugin.declaration.label = { en_US: 'Test Plugin' }
    installedModelPlugin.declaration.description = { en_US: 'Test plugin description' }
    installedPlugins = [installedModelPlugin]
    modelCatalog = [
      createModelCatalogFixture({
        models: [createCatalogModelFixture({ model: 'catalog-model' })],
      }),
    ]
    requests.uninstall.mockImplementation(async () => {
      installedPlugins = []
      modelCatalog = []
      return { success: true }
    })

    const renderCard = (plugin: PluginDetail) => (
      <>
        <PluginItem plugin={plugin} />
        <InstalledPluginList category={PluginCategoryEnum.model} />
        <ModelCatalog />
      </>
    )

    const { rerender } = render(renderCard(createPluginDetail()))
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'installed plugin ids' })).toHaveTextContent(
        'plugin-1',
      ),
    )
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'model ids' })).toHaveTextContent('catalog-model'),
    )
    rerender(
      renderCard(
        createPluginDetail({
          installation_id: 'new-installation',
          declaration: createPluginDeclaration({ category: PluginCategoryEnum.model }),
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'plugin.action.delete' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(requests.uninstall).toHaveBeenCalledExactlyOnceWith('new-installation')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'installed plugin ids' })).toHaveTextContent(
        'none',
      ),
    )
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'model ids' })).toHaveTextContent('none'),
    )
  })

  it.each([
    { source: PluginSource.github, canDelete: true, canUpdate: true, update: true, info: true },
    { source: PluginSource.github, canDelete: false, canUpdate: false, update: false, info: true },
    {
      source: PluginSource.marketplace,
      canDelete: false,
      canUpdate: true,
      update: false,
      info: false,
    },
  ])(
    'exposes permitted actions for $source (delete: $canDelete, update: $canUpdate)',
    ({ source, canDelete, canUpdate, update, info }) => {
      render(
        <PluginItem
          plugin={createPluginDetail({ source })}
          canDeletePlugin={canDelete}
          canUpdatePlugin={canUpdate}
        />,
      )
      expect(!!screen.queryByRole('button', { name: 'plugin.action.delete' })).toBe(canDelete)
      expect(!!screen.queryByRole('button', { name: 'plugin.action.checkForUpdates' })).toBe(update)
      expect(!!screen.queryByRole('button', { name: 'plugin.action.pluginInfo' })).toBe(info)
    },
  )

  it.each([
    { theme: 'dark', icon: 'light.png', dark: 'dark.png', expected: 'dark.png' },
    { theme: 'light', icon: 'light.png', dark: 'dark.png', expected: 'light.png' },
    { theme: 'dark', icon: 'light.png', dark: undefined, expected: 'light.png' },
    {
      theme: 'light',
      icon: 'https://example.com/icon.png',
      dark: undefined,
      expected: 'https://example.com/icon.png',
    },
  ])('resolves the plugin icon in $theme mode: $expected', ({ theme, icon, dark, expected }) => {
    mockTheme.mockReturnValue(theme)
    render(
      <PluginItem
        plugin={createPluginDetail({
          declaration: createPluginDeclaration({ icon, icon_dark: dark }),
        })}
      />,
    )
    expect(screen.getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining(expected),
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
