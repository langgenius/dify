import type { ComponentProps } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { trackMarketplaceSiteCardClick } from '@/utils/marketplace-site-track'
import CardWrapper from '../card-wrapper'

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    getTagLabel: (name: string) => `tag:${name}`,
  }),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, footer }: { payload: Plugin; footer?: React.ReactNode }) => (
    <div data-testid="card">
      <span>{payload.name}</span>
      {footer}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ downloadCount, tags }: { downloadCount: number; tags: string[] }) => (
    <div data-testid="card-more-info">
      {downloadCount}:{tags.join('|')}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission', () => ({
  default: () => ({ canInstallPlugin: true }),
  useOptionalPluginInstallPermission: () => ({ canInstallPlugin: true }),
}))

// Keep the real dialog/iframe while preventing navigation to a remote document.
vi.mock('../../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils')>()
  return {
    ...actual,
    getPluginLinkInMarketplace: (...args: Parameters<typeof actual.getPluginLinkInMarketplace>) => {
      const url = new URL(
        actual.getPluginLinkInMarketplace(...args),
        'https://marketplace.example.test',
      )
      return `about:blank${url.search}`
    },
  }
})
// Silent installation and catalog refresh are separate, independently tested boundaries.
vi.mock('../../detail-dialog/use-silent-install', () => ({
  useSilentMarketplaceInstall: () => ({ install: vi.fn() }),
}))
vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.marketplace.pkg.get': async () => ({
        manifest: (await import('@/test/fixtures/plugin')).createPluginDeclarationFixture(),
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
    }),
  }
})

vi.mock('@/utils/marketplace-site-track', () => ({
  trackMarketplaceSiteCardClick: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
  useLocale: () => 'en-US',
}))

const deploymentState = vi.hoisted(() => ({
  deploymentEdition: 'CLOUD' as 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE',
}))

vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')
  return createSystemFeaturesStateModuleMock(() => deploymentState)
})

const plugin = {
  type: 'plugin',
  org: 'dify',
  name: 'plugin-a',
  plugin_id: 'plugin-a',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'pkg',
  icon: 'icon.png',
  verified: true,
  label: { 'en-US': 'Plugin A' },
  brief: { 'en-US': 'Brief' },
  description: { 'en-US': 'Description' },
  introduction: 'Intro',
  repository: 'https://github.com/dify/plugin-a',
  category: PluginCategoryEnum.tool,
  install_count: 42,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }, { name: 'agent' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
} as Plugin

describe('CardWrapper', () => {
  beforeEach(() => {
    deploymentState.deploymentEdition = 'CLOUD'
    vi.clearAllMocks()
  })

  const renderCardWrapper = (props: Partial<ComponentProps<typeof CardWrapper>> = {}) =>
    render(
      <ThemeProvider defaultTheme="dark" enableSystem={false}>
        <CardWrapper plugin={plugin} {...props} />
      </ThemeProvider>,
    )

  const detailTitle = 'Plugin A · plugin.detailPanel.operation.detail'
  const installTitle = 'plugin.installModal.installPlugin'

  it('opens details from the card with hidden actions and closes in place', async () => {
    const user = userEvent.setup()
    renderCardWrapper()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'plugin.detailPanel.operation.install' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Plugin A' }))
    expect(await screen.findByRole('dialog', { name: detailTitle })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps direct installation separate from details and closes the real installer', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true })
    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
    expect(await screen.findByRole('dialog', { name: installTitle })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: detailTitle })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('links explicitly enabled cards to marketplace details and records their click', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ linkToMarketplaceDetail: true })
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/plugin/dify/plugin-a')
    await user.click(link)
    expect(trackMarketplaceSiteCardClick).toHaveBeenCalledExactlyOnceWith({
      itemId: 'dify/plugin-a',
      itemType: 'plugin',
      itemName: 'Plugin A',
      section: 'list',
    })
  })

  it('blocks reinstallation while opening details with the installed state', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true, isInstalled: true })
    const installedButton = screen.getByRole('button', { name: 'plugin.task.installed' })
    expect(installedButton).toBeDisabled()
    await user.click(installedButton)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.detail' }))
    await screen.findByRole('dialog', { name: detailTitle })
    const src = screen.getByTitle(detailTitle).getAttribute('src')!
    expect(new URL(src).searchParams.get('installed')).toBe('true')
    expect(screen.queryByRole('dialog', { name: installTitle })).not.toBeInTheDocument()
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'links %s plugin details to the official site while preserving direct installation',
    async (edition) => {
      deploymentState.deploymentEdition = edition
      const user = userEvent.setup()
      renderCardWrapper({ showInstallButton: true })
      const card = screen.getByRole('link', { name: 'Plugin A' })
      const url = new URL(card.getAttribute('href')!)
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.pathname).toBe('/plugin/dify/plugin-a')
      expect(url.searchParams.get('source')).toBe(window.location.origin)
      expect(url.searchParams.get('theme')).toBe('dark')
      expect(card).toHaveAttribute('target', '_blank')
      expect(card).toHaveAttribute('rel', 'noopener noreferrer')
      expect(
        screen.getByRole('link', { name: 'plugin.detailPanel.operation.detail' }),
      ).toHaveAttribute('href', url.toString())
      expect(screen.queryByTitle(detailTitle)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
      expect(await screen.findByRole('dialog', { name: installTitle })).toBeInTheDocument()
    },
  )

  it('keeps Bundle details inside Dify in Community edition', async () => {
    deploymentState.deploymentEdition = 'COMMUNITY'
    const user = userEvent.setup()
    renderCardWrapper({ plugin: { ...plugin, type: 'bundle' } })
    await user.click(screen.getByRole('button', { name: 'Plugin A' }))
    expect(await screen.findByRole('dialog', { name: detailTitle })).toBeInTheDocument()
  })
})
