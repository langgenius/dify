import type { ReactElement } from 'react'
import type { consoleClient } from '@/service/console'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginInstallPermissionProvider } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { disableIframeNavigation } from '@/test/iframe-navigation'
import MarketplaceDetailDialog from '../index'

disableIframeNavigation()

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_URL_PREFIX: 'https://marketplace.dify.ai',
}))

const mocks = vi.hoisted(() => ({
  install: vi.fn<typeof consoleClient.workspaces.current.plugin.install.marketplace.post>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.install.marketplace.post': mocks.install,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
  }
})

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  return renderWithConsoleQuery(ui, { queryClient })
}

const plugin = createMarketplacePluginFixture()

describe('MarketplaceDetailDialog', () => {
  beforeEach(() => {
    mocks.install.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders the marketplace detail route in modal mode and closes in place', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <ThemeProvider defaultTheme="dark" enableSystem={false}>
        <MarketplaceDetailDialog open isInstalled plugin={plugin} onOpenChange={onOpenChange} />
      </ThemeProvider>,
    )

    const frame = screen.getByTitle('Plugin A · plugin.detailPanel.operation.detail')
    const url = new URL(frame.getAttribute('src')!)
    expect(url.origin).toBe('https://marketplace.dify.ai')
    expect(url.pathname).toBe('/plugins/dify/plugin-a')
    const params = url.searchParams
    expect(Object.fromEntries(params)).toMatchObject({
      installed: 'true',
      language: 'en-US',
      source: window.location.origin,
      theme: 'dark',
      view: 'modal',
      canInstall: 'true',
    })
    expect(frame).toHaveAttribute('allow', 'clipboard-write')

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('installs from the embedded detail frame without opening a confirmation dialog', async () => {
    render(
      <ThemeProvider defaultTheme="dark" enableSystem={false}>
        <MarketplaceDetailDialog open isInstalled={false} plugin={plugin} onOpenChange={vi.fn()} />
      </ThemeProvider>,
    )

    const frame = screen.getByTitle(
      'Plugin A · plugin.detailPanel.operation.detail',
    ) as HTMLIFrameElement
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')
    const installRequest = {
      type: 'dify-marketplace:install-plugin',
      pluginUniqueIdentifier: plugin.latest_package_identifier,
    }
    for (const origin of ['https://attacker.example', 'null']) {
      fireEvent(
        window,
        new MessageEvent('message', {
          data: installRequest,
          origin,
          source: frame.contentWindow,
        }),
      )
    }
    fireEvent(
      window,
      new MessageEvent('message', {
        data: installRequest,
        origin: 'https://marketplace.dify.ai',
        source: window,
      }),
    )
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          ...installRequest,
          pluginUniqueIdentifier: 'another/plugin:1.0.0',
        },
        origin: 'https://marketplace.dify.ai',
        source: frame.contentWindow,
      }),
    )
    expect(mocks.install).not.toHaveBeenCalled()

    fireEvent(
      window,
      new MessageEvent('message', {
        data: installRequest,
        origin: 'https://marketplace.dify.ai',
        source: frame.contentWindow,
      }),
    )

    await waitFor(() => expect(mocks.install).toHaveBeenCalledOnce())
    expect(mocks.install).toHaveBeenCalledWith({
      body: { plugin_unique_identifiers: [plugin.latest_package_identifier] },
    })
    expect(screen.queryByRole('dialog', { name: 'plugin.installModal.installPlugin' })).toBeNull()

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'dify-marketplace:install-plugin-status',
          pluginUniqueIdentifier: plugin.latest_package_identifier,
          status: 'success',
        },
        'https://marketplace.dify.ai',
      )
    })
  })

  it('does not install when the workspace lacks plugin.install', async () => {
    render(
      <PluginInstallPermissionProvider canInstallPlugin={false}>
        <ThemeProvider defaultTheme="dark" enableSystem={false}>
          <MarketplaceDetailDialog
            open
            isInstalled={false}
            plugin={plugin}
            onOpenChange={vi.fn()}
          />
        </ThemeProvider>
      </PluginInstallPermissionProvider>,
    )

    const frame = screen.getByTitle(
      'Plugin A · plugin.detailPanel.operation.detail',
    ) as HTMLIFrameElement
    expect(new URL(frame.getAttribute('src')!).searchParams.get('canInstall')).toBe('false')
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          type: 'dify-marketplace:install-plugin',
          pluginUniqueIdentifier: plugin.latest_package_identifier,
        },
        origin: 'https://marketplace.dify.ai',
        source: frame.contentWindow,
      }),
    )

    expect(mocks.install).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'dify-marketplace:install-plugin-status',
          pluginUniqueIdentifier: plugin.latest_package_identifier,
          status: 'failed',
        },
        'https://marketplace.dify.ai',
      )
    })
  })

  it('ignores a late install result after the timeout has already settled', async () => {
    vi.useFakeTimers()
    const installation = createDeferred<Awaited<ReturnType<typeof mocks.install>>>()
    mocks.install.mockReturnValue(installation.promise)

    try {
      render(
        <ThemeProvider defaultTheme="dark" enableSystem={false}>
          <MarketplaceDetailDialog
            open
            isInstalled={false}
            plugin={plugin}
            onOpenChange={vi.fn()}
          />
        </ThemeProvider>,
      )

      const frame = screen.getByTitle(
        'Plugin A · plugin.detailPanel.operation.detail',
      ) as HTMLIFrameElement
      const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')
      fireEvent(
        window,
        new MessageEvent('message', {
          data: {
            type: 'dify-marketplace:install-plugin',
            pluginUniqueIdentifier: plugin.latest_package_identifier,
          },
          origin: 'https://marketplace.dify.ai',
          source: frame.contentWindow,
        }),
      )

      await act(async () => vi.advanceTimersByTimeAsync(5 * 60 * 1000))
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'dify-marketplace:install-plugin-status',
          pluginUniqueIdentifier: plugin.latest_package_identifier,
          status: 'timeout',
        },
        'https://marketplace.dify.ai',
      )

      await act(async () => {
        installation.resolve({ all_installed: true, task_id: '' })
        await installation.promise
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(postMessage).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
