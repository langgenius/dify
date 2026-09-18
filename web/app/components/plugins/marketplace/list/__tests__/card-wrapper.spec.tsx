import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ComponentProps } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { trackMarketplaceSiteCardClick } from '@/utils/marketplace-site-track'
import CardWrapper from '../card-wrapper'

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', resolvedTheme: 'dark' }),
}))

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

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_URL_PREFIX: 'https://marketplace.dify.ai',
}))

vi.mock('@/utils/marketplace-site-track', () => ({
  trackMarketplaceSiteCardClick: vi.fn(),
}))

const localeState = vi.hoisted(() => ({ locale: 'en-US' }))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const mock = createReactI18nextMock()
  return {
    ...mock,
    useTranslation: (...args: Parameters<typeof mock.useTranslation>) => ({
      ...mock.useTranslation(...args),
      i18n: { language: localeState.locale },
    }),
  }
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
  label: {
    en_US: 'Plugin A',
    zh_Hans: '插件 A',
    ja_JP: 'プラグイン A',
    pt_BR: 'Plugin em português',
  },
  brief: { en_US: 'Brief' },
  description: { en_US: 'Description' },
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
    vi.clearAllMocks()
    localeState.locale = 'en-US'
  })

  const renderCardWrapper = (
    props: Partial<ComponentProps<typeof CardWrapper>> = {},
    edition: DeploymentEdition = 'COMMUNITY',
  ) => {
    const { wrapper } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: edition },
    })
    return render(<CardWrapper plugin={plugin} {...props} />, { wrapper })
  }

  it.each([false, true])(
    'links the card to the full marketplace page with showInstallButton=%s',
    (showInstallButton) => {
      renderCardWrapper({ showInstallButton })

      const link = screen.getByRole('link', { name: 'Plugin A' })
      const url = new URL(link.getAttribute('href')!)
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.pathname).toBe('/plugins/dify/plugin-a')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        language: 'en-US',
        source: window.location.origin,
        theme: 'dark',
      })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it.each([
    ['en-US', 'Plugin A'],
    ['zh-Hans', '插件 A'],
    ['ja-JP', 'プラグイン A'],
    ['pt-BR', 'Plugin em português'],
    ['fr-FR', 'Plugin A'],
  ])('preserves the %s UI locale in detail URLs and localizes the plugin name', (locale, label) => {
    localeState.locale = locale
    renderCardWrapper({ showInstallButton: true })

    const cardLink = screen.getByRole('link', { name: label })
    const detailLink = screen.getByRole('link', { name: 'plugin.detailPanel.operation.detail' })
    for (const link of [cardLink, detailLink]) {
      const url = new URL(link.getAttribute('href')!)
      expect(url.searchParams.get('language')).toBe(locale)
    }
  })

  it('makes the card link keyboard accessible', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true })

    await user.tab()

    expect(screen.getByRole('link', { name: 'Plugin A' })).toHaveFocus()
  })

  it('keeps installation as a separate action', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true })

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
    expect(screen.getByTestId('install-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
  })

  it('keeps standalone marketplace cards on their local detail route with click tracking', async () => {
    const user = userEvent.setup()
    render(<CardWrapper plugin={plugin} linkToMarketplaceDetail />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/plugin/dify/plugin-a')
    expect(link).not.toHaveAttribute('target')
    await user.click(link)
    expect(trackMarketplaceSiteCardClick).toHaveBeenCalledWith({
      itemId: 'dify/plugin-a',
      itemType: 'plugin',
      itemName: 'Plugin A',
      section: 'list',
    })
  })

  it('uses the same external destination for the card and detail action', () => {
    renderCardWrapper({ showInstallButton: true })

    const cardLink = screen.getByRole('link', { name: 'Plugin A' })
    const detailLink = screen.getByRole('link', { name: 'plugin.detailPanel.operation.detail' })
    expect(detailLink).toHaveAttribute('href', cardLink.getAttribute('href'))
    expect(detailLink).toHaveAttribute('target', '_blank')
    expect(detailLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps installed plugin details available without allowing another installation', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true, isInstalled: true })

    const installedButton = screen.getByRole('button', { name: 'plugin.task.installed' })
    expect(installedButton).toBeDisabled()
    expect(
      screen.getByRole('link', { name: 'plugin.detailPanel.operation.detail' }),
    ).toHaveAttribute('target', '_blank')

    await user.click(installedButton)
    expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
  })

  it('preserves bundle detail destinations', () => {
    renderCardWrapper({ plugin: { ...plugin, type: 'bundle' } })

    const link = screen.getByRole('link', { name: 'Plugin A' })
    expect(new URL(link.getAttribute('href')!).pathname).toBe('/bundles/dify/plugin-a')
  })

  it('opens Enterprise plugin details in a new tab', () => {
    renderCardWrapper({ showInstallButton: true }, 'ENTERPRISE')

    expect(screen.getByRole('link', { name: 'Plugin A' })).toHaveAttribute('target', '_blank')
    expect(
      screen.getByRole('link', { name: 'plugin.detailPanel.operation.detail' }),
    ).toHaveAttribute('target', '_blank')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['Plugin A', 'plugin.detailPanel.operation.detail'])(
    'keeps the Cloud embedded detail flow for %s',
    async (name) => {
      const user = userEvent.setup()
      renderCardWrapper({ showInstallButton: true, isInstalled: true }, 'CLOUD')

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name }))
      expect(screen.getByRole('dialog', { name: 'marketplace detail' })).toHaveAttribute(
        'data-installed',
        'true',
      )
      expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'close detail' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('opens Cloud details from the keyboard even without an install action', async () => {
    const user = userEvent.setup()
    renderCardWrapper({}, 'CLOUD')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Plugin A' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'marketplace detail' })).toBeInTheDocument()
  })

  it('keeps the Cloud install action separate from details', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true }, 'CLOUD')

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
    expect(screen.getByTestId('install-modal')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
