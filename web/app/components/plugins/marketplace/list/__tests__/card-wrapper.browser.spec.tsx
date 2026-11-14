import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createPluginInstallPermissionStore,
  PluginInstallPermissionContext,
} from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import { ThemeProvider } from '@/features/theme/provider'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import CardWrapper from '../card-wrapper'

// boundary: the remote iframe document stays local; dialog rendering and message handling remain real.
vi.mock('@/features/marketplace/links', async (importOriginal) => {
  const { localMarketplaceFrameLinks } = await import('@/test/marketplace-frame-links')
  return localMarketplaceFrameLinks(
    await importOriginal<typeof import('@/features/marketplace/links')>(),
  )
})
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
  beforeEach(async () => {
    await page.viewport(1280, 900)
    onTestFinished(guardUnexpectedFetch())
  })
  afterEach(() => {
    delete window.__marketplaceTracking__
    document.documentElement.removeAttribute('data-is-marketplace')
  })

  const renderCardWrapper = async (
    props: Partial<ComponentProps<typeof CardWrapper>> = {},
    edition: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE' = 'CLOUD',
    canInstallPlugin = true,
  ) => {
    const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: edition },
    })
    seedModelProviderQueries(queryClient)
    const store = createPluginInstallPermissionStore({ canInstallPlugin })
    return render(
      <ConsoleProvider>
        <ThemeProvider defaultPreference="dark">
          <PluginInstallPermissionContext value={store}>
            <div style={{ width: 320 }}>
              <CardWrapper plugin={plugin} {...props} />
            </div>
          </PluginInstallPermissionContext>
        </ThemeProvider>
      </ConsoleProvider>,
    )
  }

  const detailTitle = 'Plugin A · plugin.detailPanel.operation.detail'
  const installTitle = 'plugin.installModal.installPlugin'

  it('opens details from the card with hidden actions and closes in place', async () => {
    const screen = await renderCardWrapper()
    await expect.element(screen.getByRole('link')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Plugin A' }))
    await expect.element(screen.getByRole('dialog', { name: detailTitle })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Plugin A', exact: true }))
      .toHaveFocus()
  })

  it('keeps direct installation separate from details and closes the real installer', async () => {
    const screen = await renderCardWrapper({ showInstallButton: true })
    await screen
      .getByRole('button', { name: 'Plugin A', exact: true })
      .hover({ position: { x: 20, y: 20 } })
    await screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }).click()
    await expect.element(screen.getByRole('dialog', { name: installTitle })).toBeInTheDocument()
    await expect.element(screen.getByRole('dialog', { name: detailTitle })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps details available without granting installation to a restricted user', async () => {
    const screen = await renderCardWrapper({ showInstallButton: true }, 'CLOUD', false)
    await expect
      .element(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Plugin A' }))
    await expect.element(screen.getByRole('dialog', { name: detailTitle })).toBeVisible()
    const src = screen.getByTitle(detailTitle).element().getAttribute('src')!
    expect(new URL(src).searchParams.get('canInstall')).toBe('false')
  })

  it('links explicitly enabled cards to marketplace details and records their click', async () => {
    const track = vi.fn()
    const rememberReferrer = vi.fn()
    document.documentElement.setAttribute('data-is-marketplace', '')
    window.__marketplaceTracking__ = {
      track,
      rememberReferrer,
      markSearch: vi.fn(),
      flushSearch: vi.fn(),
      markFilter: vi.fn(),
      flushFilter: vi.fn(),
    }
    const screen = await renderCardWrapper({ linkToMarketplaceDetail: true })
    const link = screen.getByRole('link')
    await expect.element(link).toHaveAttribute('href', '/plugin/dify/plugin-a')
    link.element().addEventListener('click', (event) => event.preventDefault(), { once: true })
    await userEvent.click(link)
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
    const screen = await renderCardWrapper({ showInstallButton: true, isInstalled: true })
    const installedButton = screen.getByRole('button', { name: 'plugin.task.installed' })
    await expect.element(installedButton).toBeDisabled()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await screen
      .getByRole('button', { name: 'Plugin A', exact: true })
      .hover({ position: { x: 20, y: 20 } })
    await screen.getByRole('button', { name: 'plugin.detailPanel.operation.detail' }).click()
    await expect.element(screen.getByRole('dialog', { name: detailTitle })).toBeVisible()
    const src = screen.getByTitle(detailTitle).element().getAttribute('src')!
    expect(new URL(src).searchParams.get('installed')).toBe('true')
    await expect.element(screen.getByRole('dialog', { name: installTitle })).not.toBeInTheDocument()
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'links %s plugin details to the official site while preserving direct installation',
    async (edition) => {
      const screen = await renderCardWrapper({ showInstallButton: true }, edition)
      const card = screen.getByRole('link', { name: 'Plugin A' })
      const url = new URL(card.element().getAttribute('href')!)
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.pathname).toBe('/plugin/dify/plugin-a')
      expect(url.searchParams.get('source')).toBe(window.location.origin)
      expect(url.searchParams.get('theme')).toBe('dark')
      await expect.element(card).toHaveAttribute('target', '_blank')
      await expect.element(card).toHaveAttribute('rel', 'noopener noreferrer')
      await expect
        .element(screen.getByRole('link', { name: 'plugin.detailPanel.operation.detail' }))
        .toHaveAttribute('href', url.toString())
      await expect.element(screen.getByTitle(detailTitle)).not.toBeInTheDocument()
      await screen
        .getByRole('link', { name: 'Plugin A', exact: true })
        .first()
        .hover({ position: { x: 20, y: 20 } })
      await screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }).click()
      await expect.element(screen.getByRole('dialog', { name: installTitle })).toBeInTheDocument()
    },
  )

  it('keeps Bundle details inside Dify in Community edition', async () => {
    const screen = await renderCardWrapper({ plugin: { ...plugin, type: 'bundle' } }, 'COMMUNITY')
    await userEvent.click(screen.getByRole('button', { name: 'Plugin A' }))
    await expect.element(screen.getByRole('dialog', { name: detailTitle })).toBeInTheDocument()
  })
})
