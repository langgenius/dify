import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { ReactElement } from 'react'
import type { LoadedCreatorProfile } from '../model'
import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { disableIframeNavigation } from '@/test/iframe-navigation'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import DifyCreatorProfile from '../dify-profile'

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

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  searchPlugins: vi.fn(),
  searchTemplates: vi.fn(),
  installedInfo: { 'dify/deep_research': { version: '0.0.1' } },
}))

const deepResearchPlugin = {
  type: 'plugin',
  org: 'dify',
  name: 'deep_research',
  plugin_id: 'dify/deep_research',
  latest_package_identifier: 'dify/deep_research:0.0.1@test',
  label: { 'en-US': 'Deep Research' },
  brief: { 'en-US': 'Research the web.' },
} as unknown as Plugin

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
        target: {
          type: 'plugin',
          pluginType: 'plugin',
          org: 'dify',
          name: 'deep_research',
        },
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
  pluginsByCreationId: {
    'plugin:dify/deep_research': deepResearchPlugin,
  },
  templatesByCreationId: {
    'template:template-one': template,
  },
  inventory: {
    uniqueHandle: 'creator',
    pluginHasMore: false,
    templateHasMore: false,
    pluginNextPage: 2,
    templateNextPage: 2,
  },
}

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useLocale: () => 'en-US',
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <span aria-hidden />,
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: mocks.installedInfo }),
}))

vi.mock('../../detail-dialog/use-silent-install', () => ({
  useSilentMarketplaceInstall: () => ({ install: vi.fn() }),
}))
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
          queryFn: () => mocks.searchPlugins(),
        }),
      },
      templateSearch: {
        ...actual.marketplaceQuery.templateSearch,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.templateSearch.queryOptions>[0],
        ) => ({
          ...actual.marketplaceQuery.templateSearch.queryOptions(options),
          queryFn: () => mocks.searchTemplates(),
        }),
      },
    },
  }
})

const renderWithNuqs = (element: ReactElement) => {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper()
  const result = renderWithConsoleQuery(<UrlState>{element}</UrlState>)
  return { ...result, onUrlUpdate }
}
const searchInput = () =>
  screen.getByPlaceholderText('marketplace.creatorProfile.searchPlaceholder')

describe('DifyCreatorProfile', () => {
  beforeEach(() => {
    deploymentState.deploymentEdition = 'CLOUD'
    vi.clearAllMocks()
    mocks.searchPlugins.mockResolvedValue({ data: { plugins: [searchPlugin], total: 1 } })
    mocks.searchTemplates.mockResolvedValue({ data: { templates: [template], total: 1 } })
  })

  it('opens the existing plugin detail flow with installed state', async () => {
    const user = userEvent.setup()
    renderWithNuqs(<DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />)

    await user.click(screen.getByRole('button', { name: 'Deep Research' }))

    await screen.findByRole('dialog', { name: /Deep Research/ })
    const src = screen.getByTitle(/^Deep Research/).getAttribute('src')!
    const url = new URL(src)
    expect(url.origin).toBe('https://marketplace.dify.ai')
    expect(url.pathname).toBe('/plugins/dify/deep_research')
    expect(url.searchParams.get('installed')).toBe('true')
  })

  it('opens a template detail and imports it inside Dify', async () => {
    const user = userEvent.setup()
    renderWithNuqs(<DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />)

    await user.click(screen.getByRole('button', { name: 'Research Template' }))
    await screen.findByRole('dialog', { name: /Research Template/ })
    const frame = screen.getByTitle(/^Research Template/) as HTMLIFrameElement
    expect(new URL(frame.src).pathname).toBe('/template/dify/template-one')
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'dify-marketplace:install-template', templateId: 'template-one' },
        origin: 'https://marketplace.dify.ai',
        source: frame.contentWindow,
      }),
    )
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/apps?template-id=template-one')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens search results in the same plugin dialog controller', async () => {
    const user = userEvent.setup()
    renderWithNuqs(<DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />)

    await user.type(searchInput(), 'search')
    await user.click(await screen.findByRole('option', { name: /Search result/ }))

    await screen.findByRole('dialog', { name: /Search result/ })
    const src = screen.getByTitle(/^Search result/).getAttribute('src')!
    expect(new URL(src).searchParams.get('installed')).toBe('false')
  })
  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'links %s creator inventory to official details',
    (edition) => {
      deploymentState.deploymentEdition = edition
      renderWithNuqs(<DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />)
      for (const name of ['Deep Research', 'Research Template']) {
        const link = screen.getByRole('link', { name })
        const url = new URL(link.getAttribute('href')!)
        expect(url.origin).toBe('https://marketplace.dify.ai')
        expect(url.searchParams.get('source')).toBe(window.location.origin)
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      }
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'opens %s creator search results externally',
    async (edition) => {
      deploymentState.deploymentEdition = edition
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      const user = userEvent.setup()
      const { onUrlUpdate } = renderWithNuqs(
        <DifyCreatorProfile loadedProfile={loadedProfile} locale="en-US" />,
      )
      await user.type(searchInput(), 'search')
      await user.click(await screen.findByRole('option', { name: /Search result/ }))
      expect(open).toHaveBeenCalledTimes(1)
      expect(new URL(String(open.mock.calls[0]![0])).pathname).toBe('/plugin/dify/search_result')
      await user.clear(searchInput())
      await user.type(searchInput(), 'template')
      await user.click(await screen.findByRole('option', { name: /Research Template/ }))
      expect(open).toHaveBeenCalledTimes(2)
      expect(new URL(String(open.mock.calls[1]![0])).pathname).toBe('/template/dify/template-one')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onUrlUpdate).not.toHaveBeenCalled()
    },
  )
})
