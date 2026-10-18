import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  createPluginInstallPermissionStore,
  PluginInstallPermissionContext,
} from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { disableIframeNavigation } from '@/test/iframe-navigation'
import CardWrapper from '../card-wrapper'

disableIframeNavigation()

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_URL_PREFIX: 'https://marketplace.dify.ai',
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

const plugin = createMarketplacePluginFixture()

describe('CardWrapper', () => {
  afterEach(() => {
    delete window.__marketplaceTracking__
    document.body.removeAttribute('data-is-marketplace')
  })

  const renderCardWrapper = (
    props: Partial<ComponentProps<typeof CardWrapper>> = {},
    edition: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE' = 'CLOUD',
    canInstallPlugin = true,
  ) => {
    const queryClient = createConsoleQueryClient()
    seedModelProviderQueries(queryClient)
    const store = createPluginInstallPermissionStore({ canInstallPlugin })
    return renderWithConsoleQuery(
      <ThemeProvider defaultTheme="dark" enableSystem={false}>
        <PluginInstallPermissionContext value={store}>
          <CardWrapper plugin={plugin} {...props} />
        </PluginInstallPermissionContext>
      </ThemeProvider>,
      { queryClient, systemFeatures: { deployment_edition: edition } },
    )
  }

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

  it('keeps details available without granting installation to a restricted user', async () => {
    const user = userEvent.setup()
    renderCardWrapper({ showInstallButton: true }, 'CLOUD', false)
    expect(
      screen.queryByRole('button', { name: 'plugin.detailPanel.operation.install' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Plugin A' }))
    expect(await screen.findByRole('dialog', { name: detailTitle })).toBeInTheDocument()
    const src = screen.getByTitle<HTMLIFrameElement>(detailTitle).src
    const url = new URL(src)
    expect(url.origin).toBe('https://marketplace.dify.ai')
    expect(url.pathname).toBe('/plugins/dify/plugin-a')
    expect(url.searchParams.get('canInstall')).toBe('false')
  })

  it('links explicitly enabled cards to marketplace details and records their click', async () => {
    const user = userEvent.setup()
    const track = vi.fn()
    const rememberReferrer = vi.fn()
    document.body.setAttribute('data-is-marketplace', '')
    window.__marketplaceTracking__ = {
      track,
      rememberReferrer,
      markSearch: vi.fn(),
      flushSearch: vi.fn(),
      markFilter: vi.fn(),
      flushFilter: vi.fn(),
    }
    renderCardWrapper({ linkToMarketplaceDetail: true })
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/plugin/dify/plugin-a')
    await user.click(link)
    expect(track).toHaveBeenCalledExactlyOnceWith('marketplace_card_click', {
      click_target: 'card',
      item_id: 'dify/plugin-a',
      item_type: 'plugin',
      item_name: 'Plugin A',
      section: 'list',
    })
    expect(rememberReferrer).toHaveBeenCalledExactlyOnceWith('dify/plugin-a', 'list')
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
    const src = screen.getByTitle<HTMLIFrameElement>(detailTitle).src
    expect(new URL(src).searchParams.get('installed')).toBe('true')
    expect(screen.queryByRole('dialog', { name: installTitle })).not.toBeInTheDocument()
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'links %s plugin details to the official site while preserving direct installation',
    async (edition) => {
      const user = userEvent.setup()
      renderCardWrapper({ showInstallButton: true }, edition)
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
    const user = userEvent.setup()
    renderCardWrapper({ plugin: { ...plugin, type: 'bundle' } }, 'COMMUNITY')
    await user.click(screen.getByRole('button', { name: 'Plugin A' }))
    expect(await screen.findByRole('dialog', { name: detailTitle })).toBeInTheDocument()
    expect(new URL(screen.getByTitle<HTMLIFrameElement>(detailTitle).src).pathname).toBe(
      '/bundles/dify/plugin-a',
    )
  })
})
