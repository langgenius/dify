import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { uninstallPlugin } from './plugins'

const { mockUninstallPost } = vi.hoisted(() => ({
  mockUninstallPost: vi.fn(),
}))

vi.mock('./base', () => ({
  get: vi.fn(),
  getMarketplace: vi.fn(),
  post: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('./client', () => ({
  consoleClient: {
    workspaces: {
      current: {
        plugin: {
          uninstall: {
            post: mockUninstallPost,
          },
        },
      },
    },
  },
}))

describe('uninstallPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUninstallPost.mockResolvedValue({ success: true })
  })

  it('should delete credentials for an ordinary uninstall by default', async () => {
    await uninstallPlugin('installation-id')

    expect(mockUninstallPost).toHaveBeenCalledWith({
      body: {
        plugin_installation_id: 'installation-id',
        preserve_credentials: false,
      },
    })
  })

  it('should preserve credentials when requested for a replacement', async () => {
    await uninstallPlugin('installation-id', { preserveCredentials: true })

    expect(mockUninstallPost).toHaveBeenCalledWith({
      body: {
        plugin_installation_id: 'installation-id',
        preserve_credentials: true,
      },
    })
  })
})
