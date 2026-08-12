import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import MarketplaceDetailDialog from '../index'

vi.mock('../../utils', () => ({
  getPluginLinkInMarketplace: (
    plugin: Plugin,
    params: { installed: string; language: string; source?: string; theme?: string; view: string },
  ) =>
    `about:blank?plugin=${plugin.org}/${plugin.name}&installed=${params.installed}&language=${params.language}&source=${params.source}&theme=${params.theme}&view=${params.view}`,
}))

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
  tags: [],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
} as Plugin

describe('MarketplaceDetailDialog', () => {
  it('renders the marketplace detail route in modal mode and closes in place', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <ThemeProvider forcedTheme="dark">
        <MarketplaceDetailDialog
          open
          isInstalled
          plugin={plugin}
          onInstall={vi.fn()}
          onOpenChange={onOpenChange}
        />
      </ThemeProvider>,
    )

    const frame = screen.getByTitle('Plugin A · plugin.detailPanel.operation.detail')
    expect(frame).toHaveAttribute(
      'src',
      'about:blank?plugin=dify/plugin-a&installed=true&language=en-US&source=http://localhost:3000&theme=system&view=modal',
    )
    expect(document.querySelector('.bg-linear-to-t')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('forwards a validated install request from the embedded detail frame', () => {
    const onInstall = vi.fn()

    render(
      <ThemeProvider forcedTheme="dark">
        <MarketplaceDetailDialog
          open
          isInstalled={false}
          plugin={plugin}
          onInstall={onInstall}
          onOpenChange={vi.fn()}
        />
      </ThemeProvider>,
    )

    const frame = screen.getByTitle(
      'Plugin A · plugin.detailPanel.operation.detail',
    ) as HTMLIFrameElement
    const installRequest = {
      type: 'dify-marketplace:install-plugin',
      pluginUniqueIdentifier: plugin.latest_package_identifier,
    }
    fireEvent(
      window,
      new MessageEvent('message', {
        data: installRequest,
        origin: 'https://attacker.example',
        source: frame.contentWindow,
      }),
    )
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          ...installRequest,
          pluginUniqueIdentifier: 'another/plugin:1.0.0',
        },
        origin: 'null',
        source: frame.contentWindow,
      }),
    )
    expect(onInstall).not.toHaveBeenCalled()

    fireEvent(
      window,
      new MessageEvent('message', {
        data: installRequest,
        origin: 'null',
        source: frame.contentWindow,
      }),
    )

    expect(onInstall).toHaveBeenCalledOnce()
  })
})
