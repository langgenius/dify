import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('@/next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
}))

describe('PluginList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('redirects a package install link to its category integration', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: {
          plugin: {
            category: 'tool',
          },
        },
      }),
    })
    const { default: PluginList } = await import('./page')

    await expect(
      PluginList({
        searchParams: Promise.resolve({
          'package-ids': '["langgenius/example-tool"]',
        }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/integrations/tools/built-in?package-ids=%5B%22langgenius%2Fexample-tool%22%5D',
    )
  })

  it('redirects to integrations when category resolution fails', async () => {
    mocks.fetch.mockResolvedValue({ ok: false })
    const { default: PluginList } = await import('./page')

    await expect(
      PluginList({
        searchParams: Promise.resolve({
          'package-ids': '["langgenius/example-tool"]',
        }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/integrations')
  })

  it('redirects to integrations when category resolution request rejects', async () => {
    mocks.fetch.mockRejectedValue(new Error('Marketplace unavailable'))
    const { default: PluginList } = await import('./page')

    await expect(
      PluginList({
        searchParams: Promise.resolve({
          'package-ids': '["langgenius/example-tool"]',
        }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/integrations')
  })
})
