import type { ComponentProps } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { render } from '@/test/console/render'
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

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="install-modal">
      <button data-testid="close-install-modal" onClick={onClose}>
        close
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission', () => ({
  default: () => ({ canInstallPlugin: true }),
  useOptionalPluginInstallPermission: () => ({ canInstallPlugin: true }),
}))

vi.mock('../../detail-dialog', () => ({
  default: ({
    isInstalled,
    open,
    onOpenChange,
  }: {
    isInstalled: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div role="dialog" aria-label="marketplace detail" data-installed={isInstalled}>
        <button type="button" onClick={() => onOpenChange(false)}>
          close detail
        </button>
      </div>
    ) : null,
}))

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
      <ThemeProvider forcedTheme="dark">
        <CardWrapper plugin={plugin} {...props} />
      </ThemeProvider>,
    )

  it('renders a non-navigating card by default when install button is hidden', () => {
    renderCardWrapper()

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelector('[data-marketplace-card="plugin-a"]')).toBeInTheDocument()
    expect(screen.getByTestId('card-more-info')).toHaveTextContent('42:tag:search|tag:agent')
  })

  it('opens marketplace detail from the card surface', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true })

    await user.click(screen.getByRole('button', { name: 'Plugin A' }))

    expect(screen.getByRole('dialog', { name: 'marketplace detail' })).toBeInTheDocument()
    expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
  })

  it('opens marketplace detail from the keyboard', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true })

    await user.tab()
    expect(screen.getByRole('button', { name: 'Plugin A' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog', { name: 'marketplace detail' })).toBeInTheDocument()
  })

  it('keeps install as its own action when the card is clicked through the install button', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true })

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))

    expect(screen.getByTestId('install-modal')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'marketplace detail' })).not.toBeInTheDocument()
  })

  it('links the card to its marketplace detail when explicitly enabled', () => {
    renderCardWrapper({ linkToMarketplaceDetail: true })

    expect(screen.getByRole('link')).toHaveAttribute('href', '/plugin/dify/plugin-a')
    fireEvent.click(screen.getByRole('link'))
    expect(trackMarketplaceSiteCardClick).toHaveBeenCalledWith({
      itemId: 'dify/plugin-a',
      itemType: 'plugin',
      itemName: 'Plugin A',
      section: 'list',
    })
  })

  it('renders install and marketplace detail actions when install button is shown', () => {
    renderCardWrapper({ showInstallButton: true })

    expect(
      screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'plugin.detailPanel.operation.detail' }),
    ).toBeInTheDocument()
  })

  it('shows a disabled installed action and prevents another installation', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true, isInstalled: true })

    const installedButton = screen.getByRole('button', { name: 'plugin.task.installed' })
    expect(installedButton).toBeDisabled()

    await user.click(installedButton)
    expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
  })

  it('opens and closes marketplace detail dialog from the detail action', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true, isInstalled: true })

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.detail' }))
    expect(screen.getByRole('dialog', { name: 'marketplace detail' })).toHaveAttribute(
      'data-installed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'close detail' }))
    expect(screen.queryByRole('dialog', { name: 'marketplace detail' })).not.toBeInTheDocument()
  })

  it('opens and closes install modal from install action', () => {
    renderCardWrapper({ showInstallButton: true })

    fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
    expect(screen.getByTestId('install-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('close-install-modal'))
    expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
  })

  it('does not open the install confirmation modal from the marketplace detail dialog', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true })

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.detail' }))

    expect(screen.getByRole('dialog', { name: 'marketplace detail' })).toBeInTheDocument()
    expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
  })
  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'links %s plugin details to the official site while preserving direct installation',
    async (edition) => {
      deploymentState.deploymentEdition = edition
      const user = userEvent.setup()
      render(<CardWrapper plugin={plugin} showInstallButton />)

      const card = screen.getByRole('link', { name: 'Plugin A' })
      const url = new URL(card.getAttribute('href')!)
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.pathname).toBe('/plugin/dify/plugin-a')
      expect(url.searchParams.get('source')).toBe(window.location.origin)
      expect([...url.searchParams.keys()].sort()).toEqual(['language', 'source'])
      expect(card).toHaveAttribute('target', '_blank')
      expect(card).toHaveAttribute('rel', 'noopener noreferrer')
      expect(
        screen.getByRole('link', { name: 'plugin.detailPanel.operation.detail' }),
      ).toHaveAttribute('href', url.toString())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.querySelector('iframe')).toBeNull()

      await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
      expect(screen.getByTestId('install-modal')).toBeInTheDocument()
    },
  )

  it('keeps Bundle details inside Dify in Community edition', async () => {
    deploymentState.deploymentEdition = 'COMMUNITY'
    const user = userEvent.setup()
    render(<CardWrapper plugin={{ ...plugin, type: 'bundle' }} />)
    await user.click(screen.getByRole('button', { name: 'Plugin A' }))
    expect(screen.getByRole('dialog', { name: 'marketplace detail' })).toBeInTheDocument()
  })
})
