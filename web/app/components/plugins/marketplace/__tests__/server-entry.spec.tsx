import type { ReactNode } from 'react'
import type { PluginBanner } from '../home/banners'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchPluginBanners, mockGetLocaleOnServer } = vi.hoisted(() => ({
  mockFetchPluginBanners: vi.fn(),
  mockGetLocaleOnServer: vi.fn(),
}))

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: mockGetLocaleOnServer,
}))

vi.mock('../home/banners', async (importOriginal) => {
  const original = await importOriginal<typeof import('../home/banners')>()

  return {
    ...original,
    fetchPluginBanners: mockFetchPluginBanners,
  }
})

vi.mock('../hydration-server', () => ({
  HydrateQueryClient: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('../view', () => ({
  MarketplaceView: ({ banners }: { banners: PluginBanner[] }) => (
    <p>Server banners: {banners.length}</p>
  ),
}))

describe('Marketplace server entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefetches localized homepage banners before rendering the standalone view', async () => {
    mockGetLocaleOnServer.mockResolvedValue('en-US')
    mockFetchPluginBanners.mockResolvedValue([
      {
        id: 'banner-1',
        title: 'Trending',
        sort: 1,
        language: 'en-US',
        style_type: 'blog',
        content: {
          blog_title: 'Dify update',
          link: 'https://dify.ai/blog',
          link_target_type: 'blog',
        },
      },
    ] satisfies PluginBanner[])

    const { default: Marketplace } = await import('../index')
    const element = await Marketplace({ variant: 'home' })

    render(element)

    expect(screen.getByText('Server banners: 1')).toBeInTheDocument()
    expect(mockGetLocaleOnServer).toHaveBeenCalledOnce()
    expect(mockFetchPluginBanners).toHaveBeenCalledWith('en-US')
  })
})
