import type { ConsoleClient } from '../support/api/console-client'
import { ORPCError } from '@orpc/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapMarketplacePlugins } from '../support/marketplace-plugins'

const createMarketplaceConsoleClient = (installError: unknown) => {
  const installMarketplace = vi.fn().mockRejectedValue(installError)
  const uploadPackage = vi.fn().mockResolvedValue({
    unique_identifier: 'langgenius/test:1.0.0@package',
  })
  const installPackage = vi.fn().mockResolvedValue({ all_installed: true })
  const consoleClient = {
    workspaces: {
      current: {
        plugin: {
          install: {
            marketplace: { post: installMarketplace },
            pkg: { post: installPackage },
          },
          list: {
            installations: {
              ids: { post: vi.fn().mockResolvedValue({ plugins: [] }) },
            },
            latestVersions: {
              post: vi.fn().mockResolvedValue({
                versions: {
                  'langgenius/test': {
                    unique_identifier: 'langgenius/test:1.0.0@marketplace',
                  },
                },
              }),
            },
          },
          upload: { pkg: { post: uploadPackage } },
        },
      },
    },
  } as unknown as ConsoleClient

  return { consoleClient, installPackage, uploadPackage }
}

const bootstrapTestPlugin = (consoleClient: ConsoleClient) =>
  bootstrapMarketplacePlugins(
    { consoleClient, dryRun: false, resources: new Map() },
    {
      defaultPluginIds: ['langgenius/test'],
      pluginIdsEnv: 'E2E_TEST_MARKETPLACE_PLUGIN_IDS',
      title: 'Test marketplace plugin',
    },
  )

describe('bootstrapMarketplacePlugins', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses generated package upload when the API process cannot download from Marketplace', async () => {
    vi.stubEnv('E2E_TEST_MARKETPLACE_PLUGIN_IDS', '')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('plugin-package'))
    const { consoleClient, installPackage, uploadPackage } = createMarketplaceConsoleClient(
      new ORPCError('INTERNAL_SERVER_ERROR', {
        data: {
          body: {
            message:
              'Reached maximum retries (3) for URL https://marketplace.test/plugins/download',
          },
        },
        status: 500,
      }),
    )
    const result = await bootstrapTestPlugin(consoleClient)

    expect(result.status).toBe('verified')
    expect(uploadPackage).toHaveBeenCalledWith({
      body: { pkg: expect.any(File) },
    })
    expect(installPackage).toHaveBeenCalledWith({
      body: { plugin_unique_identifiers: ['langgenius/test:1.0.0@package'] },
    })
  })

  it('does not hide unrelated generated client failures behind package upload', async () => {
    vi.stubEnv('E2E_TEST_MARKETPLACE_PLUGIN_IDS', '')
    const marketplaceFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('plugin-package'))
    const { consoleClient, installPackage, uploadPackage } = createMarketplaceConsoleClient(
      new ORPCError('INTERNAL_SERVER_ERROR', {
        data: { body: { message: 'Database unavailable' } },
        status: 500,
      }),
    )

    const result = await bootstrapTestPlugin(consoleClient)

    expect(result).toEqual(
      expect.objectContaining({
        reason: expect.stringContaining('Database unavailable'),
        status: 'blocked',
      }),
    )
    expect(marketplaceFetch).not.toHaveBeenCalled()
    expect(uploadPackage).not.toHaveBeenCalled()
    expect(installPackage).not.toHaveBeenCalled()
  })
})
