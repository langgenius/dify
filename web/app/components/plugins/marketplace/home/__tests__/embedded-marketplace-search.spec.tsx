import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { disableIframeNavigation } from '@/test/iframe-navigation'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import EmbeddedMarketplaceSearch from '../embedded-marketplace-search'

disableIframeNavigation()

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_URL_PREFIX: 'https://marketplace.dify.ai',
}))

const deploymentState = vi.hoisted(() => ({
  deploymentEdition: 'CLOUD' as 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE',
}))

vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')
  return createSystemFeaturesStateModuleMock(() => deploymentState)
})

const { mockPluginSearch, mockTemplateSearch, push } = vi.hoisted(() => ({
  push: vi.fn(),
  mockPluginSearch: vi.fn(),
  mockTemplateSearch: vi.fn(),
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  const translations: Record<string, string> = {
    'marketplace.home.searchPlaceholder': 'Search plugins or templates',
    'marketplace.home.plugins': 'Plugins',
    'marketplace.home.templates': 'Templates',
    'marketplace.loadError': 'Failed to load. Please try again.',
    'marketplace.noPluginFound': 'No integration found',
    'newApp.noTemplateFound': 'No templates found',
    clearSearch: 'Clear search',
    loading: 'Loading',
  }

  return {
    useLocale: () => 'en-US',
    useTranslation: () => ({
      t: withSelectorKey((key: string) => translations[key] ?? key),
    }),
  }
})

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
          queryFn: () => mockPluginSearch(),
        }),
      },
      templateSearch: {
        ...actual.marketplaceQuery.templateSearch,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.templateSearch.queryOptions>[0],
        ) => ({
          ...actual.marketplaceQuery.templateSearch.queryOptions(options),
          queryFn: () => mockTemplateSearch(),
        }),
      },
    },
  }
})

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: {} }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('../../detail-dialog/use-silent-install', () => ({
  useSilentMarketplaceInstall: () => ({ install: vi.fn() }),
}))
const plugin = {
  type: 'plugin',
  org: 'langgenius',
  name: 'google-search',
  plugin_id: 'langgenius/google-search',
  label: { 'en-US': 'Google Search' },
  brief: { 'en-US': 'Search the web from your workflow.' },
  category: 'tool',
}
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
}
const renderSearch = () => {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper()
  renderWithConsoleQuery(
    <UrlState>
      <EmbeddedMarketplaceSearch />
    </UrlState>,
  )
  return { onUrlUpdate }
}

describe('EmbeddedMarketplaceSearch', () => {
  beforeEach(() => {
    deploymentState.deploymentEdition = 'CLOUD'
    vi.clearAllMocks()
    mockPluginSearch.mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
    mockTemplateSearch.mockResolvedValue({ data: { templates: [template], total: 1 } })
  })

  it('opens plugin and template details from the popup without filtering the catalog', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderSearch()

    await user.type(screen.getByRole('combobox'), 'search')
    await user.click(await screen.findByText('Google Search'))

    await screen.findByRole('dialog', { name: /Google Search/ })
    const pluginFrame = screen.getByTitle(/^Google Search/)
    const pluginUrl = new URL(pluginFrame.getAttribute('src')!)
    expect(pluginUrl.origin).toBe('https://marketplace.dify.ai')
    expect(pluginUrl.pathname).toBe('/plugins/langgenius/google-search')
    expect(pluginUrl.searchParams.get('installed')).toBe('false')
    expect(onUrlUpdate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.type(screen.getByRole('combobox'), 'legal')
    await user.click(await screen.findByRole('option', { name: /Legal Research Agent/ }))
    await screen.findByRole('dialog', { name: /Legal Research Agent/ })
    const frame = screen.getByTitle(/^Legal Research Agent/) as HTMLIFrameElement
    const templateUrl = new URL(frame.src)
    expect(templateUrl.origin).toBe('https://marketplace.dify.ai')
    expect(templateUrl.pathname).toBe('/template/dify/template-1')
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'dify-marketplace:install-template', templateId: 'template-1' },
        origin: 'https://marketplace.dify.ai',
        source: frame.contentWindow,
      }),
    )
    expect(push).toHaveBeenCalledExactlyOnceWith('/apps?template-id=template-1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })

  it('filters the current catalog when Enter is pressed instead of opening a result', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderSearch()

    await user.type(screen.getByRole('combobox'), 'google')
    await screen.findByRole('option', { name: /Google Search/ })
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('q')).toBe('google')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['COMMUNITY', 'plugin', 'mouse'],
    ['COMMUNITY', 'template', 'keyboard'],
    ['ENTERPRISE', 'plugin', 'keyboard'],
    ['ENTERPRISE', 'template', 'mouse'],
  ] as const)(
    'opens a %s %s result using %s without changing the catalog',
    async (edition, kind, interaction) => {
      deploymentState.deploymentEdition = edition
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      mockPluginSearch.mockResolvedValue({
        data: { plugins: kind === 'plugin' ? [plugin] : [], total: kind === 'plugin' ? 1 : 0 },
      })
      mockTemplateSearch.mockResolvedValue({
        data: {
          templates: kind === 'template' ? [template] : [],
          total: kind === 'template' ? 1 : 0,
        },
      })
      const user = userEvent.setup()
      const { onUrlUpdate } = renderSearch()
      const input = screen.getByRole('combobox')
      await user.type(input, 'search')
      const option = await screen.findByRole('option')
      if (interaction === 'mouse') await user.click(option)
      else await user.keyboard('{ArrowDown}{Enter}')
      expect(open).toHaveBeenCalledTimes(1)
      const [href, target, features] = open.mock.calls[0]!
      const url = new URL(String(href))
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.pathname).toBe(
        kind === 'plugin' ? '/plugin/langgenius/google-search' : '/template/dify/template-1',
      )
      expect(url.searchParams.get('source')).toBe(window.location.origin)
      expect(target).toBe('_blank')
      expect(features).toBe('noopener,noreferrer')
      expect(input).toHaveValue('search')
      expect(onUrlUpdate).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )
})
