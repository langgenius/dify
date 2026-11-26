import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { uninstallPlugin, uploadFile } from './plugins'

const { mockUninstallPost, mockUploadBundle, mockUploadPkg } = vi.hoisted(() => ({
  mockUninstallPost: vi.fn(),
  mockUploadBundle: vi.fn(),
  mockUploadPkg: vi.fn(),
}))

vi.mock('./base', () => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    workspaces: {
      current: {
        plugin: {
          uninstall: {
            post: mockUninstallPost,
          },
          upload: {
            bundle: { post: mockUploadBundle },
            pkg: { post: mockUploadPkg },
          },
        },
      },
    },
  },
}))

describe('uninstallPlugin', () => {
  beforeEach(() => {
    mockUninstallPost.mockReset().mockResolvedValue({ success: true })
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

describe('uploadFile', () => {
  const options = { context: { onUploadProgress: expect.any(Function) } }

  it('uploads a plugin package as the pkg field', async () => {
    const file = new File(['pkg'], 'tool.difypkg')
    mockUploadPkg.mockResolvedValue({ unique_identifier: 'tool:1.0.0' })

    await expect(uploadFile(file, false)).resolves.toEqual({ unique_identifier: 'tool:1.0.0' })

    expect(mockUploadPkg).toHaveBeenCalledExactlyOnceWith({ body: { pkg: file } }, options)
    expect(mockUploadBundle).not.toHaveBeenCalled()
  })

  it('uploads a plugin bundle as the bundle field', async () => {
    const file = new File(['bundle'], 'tools.difybndl')
    mockUploadBundle.mockResolvedValue([])

    await expect(uploadFile(file, true)).resolves.toEqual([])

    expect(mockUploadBundle).toHaveBeenCalledExactlyOnceWith({ body: { bundle: file } }, options)
  })
})
