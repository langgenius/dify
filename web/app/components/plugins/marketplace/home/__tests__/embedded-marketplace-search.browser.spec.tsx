import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import pluginMessages from '@/i18n/locales/en-US/plugin.json'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import EmbeddedMarketplaceSearch from '../embedded-marketplace-search'

const boundary = vi.hoisted(() => ({
  push: vi.fn(),
  searchPlugins: vi.fn(),
  searchTemplates: vi.fn(),
}))

vi.unmock('react-i18next')

// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: boundary.push }),
}))

// boundary: autocomplete suggestions stop at the external Marketplace HTTP client.
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
          queryFn: () => boundary.searchPlugins(options.input),
        }),
      },
      templateSearch: {
        ...actual.marketplaceQuery.templateSearch,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.templateSearch.queryOptions>[0],
        ) => ({
          ...actual.marketplaceQuery.templateSearch.queryOptions(options),
          queryFn: () => boundary.searchTemplates(options.input),
        }),
      },
    },
  }
})

// boundary: installed-plugin reads stop at the generated console transport.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
  }
})

// boundary: remote Marketplace documents stay local while preserving their real query parameters.
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

const plugin = {
  type: 'plugin',
  org: 'langgenius',
  name: 'google-search',
  plugin_id: 'langgenius/google-search',
  latest_package_identifier: 'langgenius/google-search:1.0.0@test',
  label: { 'en-US': 'Google Search' },
  brief: { 'en-US': 'Search the web from your workflow.' },
  category: 'tool',
} as Plugin

const template = {
  id: 'template-1',
  template_name: 'Legal Research Agent',
  overview: 'Research legal questions with cited sources.',
  publisher_unique_handle: 'dify',
  usage_count: 120,
  categories: ['knowledge'],
  icon: '📄',
  icon_background: '#FFFFFF',
  icon_file_key: '',
} as MarketplaceTemplate

async function renderSearch(edition: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE' = 'CLOUD') {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { app, common, navigation, plugin: pluginMessages } },
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({ hasMemory: true })
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
  })
  seedModelProviderQueries(queryClient)
  const screen = await render(
    <ConsoleProvider>
      <I18nextProvider i18n={i18n}>
        <UrlState>
          <EmbeddedMarketplaceSearch />
        </UrlState>
      </I18nextProvider>
    </ConsoleProvider>,
  )
  return { onUrlUpdate, screen }
}

describe('Embedded Marketplace search', () => {
  beforeEach(async () => {
    await page.viewport(1000, 800)
    onTestFinished(guardUnexpectedFetch())
    vi.clearAllMocks()
    boundary.searchPlugins.mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
    boundary.searchTemplates.mockResolvedValue({ data: { templates: [template], total: 1 } })
  })

  it('opens both Cloud result dialogs, closes them, and leaves catalog filters untouched', async () => {
    const { onUrlUpdate, screen } = await renderSearch()
    const search = screen.getByRole('combobox', { name: 'Search plugins or templates' })

    await search.fill('search')
    await screen.getByRole('option', { name: /Google Search/ }).click()
    const pluginDialog = screen.getByRole('dialog', { name: /Google Search/ })
    await expect.element(pluginDialog).toBeVisible()
    await expect
      .element(screen.getByTitle(/^Google Search/))
      .toHaveAttribute('src', expect.stringContaining('installed=false'))
    await pluginDialog.getByRole('button', { name: 'Close' }).click()
    await expect.element(pluginDialog).not.toBeInTheDocument()

    await search.fill('legal')
    await screen.getByRole('option', { name: /Legal Research Agent/ }).click()
    const templateDialog = screen.getByRole('dialog', { name: /Legal Research Agent/ })
    await expect.element(templateDialog).toBeVisible()
    await templateDialog.getByRole('button', { name: 'Close' }).click()
    await expect.element(templateDialog).not.toBeInTheDocument()
    await expect.element(search).toHaveFocus()
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })

  it('uses native Enter submission to filter the catalog instead of opening a result', async () => {
    const { onUrlUpdate, screen } = await renderSearch()
    const search = screen.getByRole('combobox', { name: 'Search plugins or templates' })

    await search.fill('google')
    await expect.element(screen.getByRole('option', { name: /Google Search/ })).toBeVisible()
    await userEvent.keyboard('{Enter}')

    await expect.poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('q')).toBe('google')
    await expect.element(search).toHaveValue('google')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['COMMUNITY', 'plugin', 'Google Search'],
    ['ENTERPRISE', 'template', 'Legal Research Agent'],
  ] as const)(
    'opens a %s %s on the official site without changing the catalog',
    async (edition, kind, label) => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      boundary.searchPlugins.mockResolvedValue({
        data: { plugins: kind === 'plugin' ? [plugin] : [], total: kind === 'plugin' ? 1 : 0 },
      })
      boundary.searchTemplates.mockResolvedValue({
        data: {
          templates: kind === 'template' ? [template] : [],
          total: kind === 'template' ? 1 : 0,
        },
      })
      const { onUrlUpdate, screen } = await renderSearch(edition)
      const search = screen.getByRole('combobox', { name: 'Search plugins or templates' })

      await search.fill('search')
      const option = screen.getByRole('option', { name: new RegExp(label) })
      await expect.element(option).toBeVisible()
      if (kind === 'plugin') await option.click()
      else {
        await userEvent.keyboard('{ArrowDown}')
        await userEvent.keyboard('{Enter}')
      }

      expect(open).toHaveBeenCalledOnce()
      const opened = new URL(String(open.mock.calls[0]![0]))
      expect(opened.origin).toBe('https://marketplace.dify.ai')
      expect(opened.pathname).toBe(
        kind === 'plugin' ? '/plugin/langgenius/google-search' : '/template/dify/template-1',
      )
      expect(opened.searchParams.get('source')).toBe(window.location.origin)
      await expect.element(search).toHaveValue('search')
      await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
      expect(onUrlUpdate).not.toHaveBeenCalled()
    },
  )
})
