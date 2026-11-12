import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { LoadedCreatorProfile } from '../model'
import type { Plugin } from '@/app/components/plugins/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import DifyCreatorProfile from '../dify-profile'

const api = vi.hoisted(() => ({
  push: vi.fn(),
  searchPlugins: vi.fn(),
  searchTemplates: vi.fn(),
  installed: vi.fn(),
}))

// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: api.push }),
}))

// boundary: embedded Marketplace documents stay local while preserving their real route parameters.
vi.mock('@/features/marketplace/links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/marketplace/links')>()
  const toBlank = (url: string) =>
    `about:blank${new URL(url, 'https://marketplace.example.test').search}`
  return {
    ...actual,
    marketplaceLinks: {
      ...actual.marketplaceLinks,
      plugin: (...args: Parameters<typeof actual.marketplaceLinks.plugin>) =>
        toBlank(actual.marketplaceLinks.plugin(...args)),
      template: (...args: Parameters<typeof actual.marketplaceLinks.template>) =>
        toBlank(actual.marketplaceLinks.template(...args)),
    },
  }
})

// boundary: creator search stops at the external Marketplace HTTP client.
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceQuery: {
      ...actual.marketplaceQuery,
      searchAdvanced: {
        ...actual.marketplaceQuery.searchAdvanced,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.searchAdvanced.queryOptions>[0],
        ) => ({
          ...actual.marketplaceQuery.searchAdvanced.queryOptions(options),
          queryFn: () => api.searchPlugins(),
        }),
      },
      templateSearch: {
        ...actual.marketplaceQuery.templateSearch,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.templateSearch.queryOptions>[0],
        ) => ({
          ...actual.marketplaceQuery.templateSearch.queryOptions(options),
          queryFn: () => api.searchTemplates(),
        }),
      },
    },
  }
})

// boundary: installed-plugin reads and silent-install mutations stop at the console transport.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': api.installed,
    }),
  }
})

const deepResearchPlugin = {
  type: 'plugin',
  org: 'dify',
  name: 'deep_research',
  plugin_id: 'dify/deep_research',
  latest_package_identifier: 'dify/deep_research:0.0.1@test',
  label: { 'en-US': 'Deep Research' },
  brief: { 'en-US': 'Research the web.' },
} as Plugin

const searchPlugin = {
  ...deepResearchPlugin,
  name: 'search_result',
  plugin_id: 'dify/search_result',
  latest_package_identifier: 'dify/search_result:0.0.1@test',
  label: { 'en-US': 'Search result' },
} as Plugin

const template: MarketplaceTemplate = {
  id: 'template-one',
  template_name: 'Research Template',
  overview: 'Build a research app.',
  icon: 'R',
  icon_background: '#fff',
  icon_file_key: '',
  publisher_unique_handle: 'dify',
  usage_count: 1,
  categories: [],
}

const loadedProfile: LoadedCreatorProfile = {
  viewModel: {
    profile: {
      kind: 'individual',
      displayName: 'Creator',
      handle: 'creator',
      avatarUrl: '',
      backgroundUrl: '',
      badges: [],
      socialLinks: [],
    },
    creations: [
      {
        id: 'plugin:dify/deep_research',
        kind: 'plugin',
        title: 'Deep Research',
        description: 'Research the web.',
        target: { type: 'plugin', pluginType: 'plugin', org: 'dify', name: 'deep_research' },
        icon: { type: 'emoji', value: 'R' },
        dependencyIcons: [],
        dependencyCount: 0,
        updatedAt: 1,
        createdAt: 1,
        popularity: 1,
      },
      {
        id: 'template:template-one',
        kind: 'template',
        title: 'Research Template',
        description: 'Build a research app.',
        target: {
          type: 'template',
          id: 'template-one',
          publisher: 'dify',
          templateName: 'Research Template',
        },
        icon: { type: 'emoji', value: 'R' },
        dependencyIcons: [],
        dependencyCount: 0,
        updatedAt: 1,
        createdAt: 1,
        popularity: 1,
      },
    ],
  },
  pluginsByCreationId: { 'plugin:dify/deep_research': deepResearchPlugin },
  templatesByCreationId: { 'template:template-one': template },
  inventory: {
    uniqueHandle: 'creator',
    pluginHasMore: false,
    templateHasMore: false,
    pluginNextPage: 2,
    templateNextPage: 2,
  },
}

async function renderProfile(edition: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE' = 'CLOUD') {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({ hasMemory: true })
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
  })
  seedModelProviderQueries(queryClient, [])
  const screen = await render(
    <ConsoleProvider>
      <UrlState>
        <DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />
      </UrlState>
    </ConsoleProvider>,
  )
  return { screen, onUrlUpdate }
}

async function chooseSearchResult(
  screen: Awaited<ReturnType<typeof renderProfile>>['screen'],
  query: string,
  name: RegExp,
) {
  api.searchPlugins.mockResolvedValue({
    data: { plugins: query === 'search' ? [searchPlugin] : [], total: query === 'search' ? 1 : 0 },
  })
  api.searchTemplates.mockResolvedValue({
    data: {
      templates: query === 'template' ? [template] : [],
      total: query === 'template' ? 1 : 0,
    },
  })
  const search = screen.getByPlaceholder('plugin.marketplace.creatorProfile.searchPlaceholder')
  await search.fill(query)
  await expect.element(screen.getByRole('option', { name })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(search).toHaveAttribute('aria-activedescendant')
  await userEvent.keyboard('{Enter}')
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
  vi.clearAllMocks()
  const installed = createPluginEntity({
    id: 'installed-deep-research',
    plugin_id: 'dify/deep_research',
    plugin_unique_identifier: 'dify/deep_research:0.0.1@test',
  })
  api.installed.mockResolvedValue({ plugins: [installed] })
  api.searchPlugins.mockResolvedValue({ data: { plugins: [], total: 0 } })
  api.searchTemplates.mockResolvedValue({ data: { templates: [], total: 0 } })
})

it('runs the Cloud header, installed card, close/reopen focus, and search result through one owner', async () => {
  const { screen } = await renderProfile()
  const marketplace = screen.getByRole('link', { name: 'Dify Marketplace' })
  await expect.element(marketplace).toHaveAttribute('href', '/marketplace')
  for (const name of ['plugin.marketplace.home.plugins', 'plugin.marketplace.home.templates']) {
    await expect.element(screen.getByRole('link', { name })).not.toHaveAttribute('aria-current')
  }

  const card = screen.getByRole('button', { name: 'Deep Research' })
  await card.click()
  const installedDialog = screen.getByRole('dialog', { name: /Deep Research/ })
  await expect.element(installedDialog).toBeVisible()
  const installedFrame = screen.getByTitle(/^Deep Research/)
  expect(new URL(installedFrame.element().getAttribute('src')!).searchParams.get('installed')).toBe(
    'true',
  )
  await userEvent.keyboard('{Escape}')
  await expect.element(installedDialog).not.toBeInTheDocument()
  await expect.element(card).toHaveFocus()

  await chooseSearchResult(screen, 'search', /Search result/)
  const searchDialog = screen.getByRole('dialog', { name: /Search result/ })
  await expect.element(searchDialog).toBeVisible()
  const searchFrame = screen.getByTitle(/^Search result/)
  expect(new URL(searchFrame.element().getAttribute('src')!).searchParams.get('installed')).toBe(
    'false',
  )
})

it('imports a template only after the real embedded dialog sends its install message', async () => {
  const { screen } = await renderProfile()
  await screen.getByRole('button', { name: 'Research Template' }).click()
  const dialog = screen.getByRole('dialog', { name: /Research Template/ })
  await expect.element(dialog).toBeVisible()
  const frame = screen.getByTitle(/^Research Template/).element() as HTMLIFrameElement

  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'dify-marketplace:install-template', templateId: 'template-one' },
      origin: 'null',
      source: frame.contentWindow,
    }),
  )

  await expect
    .poll(() => api.push)
    .toHaveBeenCalledExactlyOnceWith('/apps?template-id=template-one')
  await expect.element(dialog).not.toBeInTheDocument()
})

it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
  'uses native external links and popup navigation for the %s edition',
  async (edition) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { screen, onUrlUpdate } = await renderProfile(edition)
    for (const name of ['Deep Research', 'Research Template']) {
      const link = screen.getByRole('link', { name })
      const url = new URL(link.element().getAttribute('href')!)
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.searchParams.get('source')).toBe(window.location.origin)
      await expect.element(link).toHaveAttribute('target', '_blank')
      await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')
    }

    await chooseSearchResult(screen, 'search', /Search result/)
    expect(open).toHaveBeenCalledOnce()
    expect(new URL(String(open.mock.calls[0]![0])).pathname).toBe('/plugin/dify/search_result')
    await chooseSearchResult(screen, 'template', /Research Template/)
    expect(open).toHaveBeenCalledTimes(2)
    expect(new URL(String(open.mock.calls[1]![0])).pathname).toBe('/template/dify/template-one')
    expect(onUrlUpdate).not.toHaveBeenCalled()
  },
)
