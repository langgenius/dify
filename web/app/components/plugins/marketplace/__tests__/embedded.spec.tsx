import type { ReactNode } from 'react'
import type { PluginBanner } from '../home/banners'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetchPluginBanners = vi.fn()

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'zh-Hans',
}))

vi.mock('../home/banners', async (importOriginal) => {
  const original = await importOriginal<typeof import('../home/banners')>()

  return {
    ...original,
    fetchPluginBanners: (...args: unknown[]) => mockFetchPluginBanners(...args),
  }
})

vi.mock('../view', () => ({
  MarketplaceView: ({
    banners,
    showInstallButton,
  }: {
    banners: PluginBanner[]
    showInstallButton: boolean
  }) => (
    <div>
      <p>Trending banners: {banners.length}</p>
      <p>{showInstallButton ? 'Install enabled' : 'Install disabled'}</p>
    </div>
  ),
}))

let queryClient: QueryClient

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('EmbeddedMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    })
  })

  it('loads homepage banners on the client for the active locale', async () => {
    mockFetchPluginBanners.mockResolvedValue([
      {
        id: 'banner-1',
        title: 'Trending',
        sort: 1,
        language: 'zh-Hans',
        style_type: 'blog',
        content: {
          blog_title: 'Dify update',
          link: 'https://dify.ai/blog',
          link_target_type: 'blog',
        },
      },
    ] satisfies PluginBanner[])

    const { EmbeddedMarketplace } = await import('../embedded')

    render(<EmbeddedMarketplace showInstallButton variant="home" />, { wrapper: Wrapper })

    expect(await screen.findByText('Trending banners: 1')).toBeInTheDocument()
    expect(screen.getByText('Install enabled')).toBeInTheDocument()
    expect(mockFetchPluginBanners).toHaveBeenCalledWith('zh-Hans')
  })

  it('uses server-rendered homepage banners without requesting them again on hydration', async () => {
    const initialBanners = [
      {
        id: 'banner-1',
        title: 'Trending',
        sort: 1,
        language: 'zh-Hans',
        style_type: 'blog',
        content: {
          blog_title: 'Dify update',
          link: 'https://dify.ai/blog',
          link_target_type: 'blog',
        },
      },
    ] satisfies PluginBanner[]

    const { EmbeddedMarketplace } = await import('../embedded')

    render(
      <EmbeddedMarketplace
        initialBanners={initialBanners}
        initialLocale="zh-Hans"
        showInstallButton
        variant="home"
      />,
      { wrapper: Wrapper },
    )

    expect(screen.getByText('Trending banners: 1')).toBeInTheDocument()
    expect(mockFetchPluginBanners).not.toHaveBeenCalled()
  })

  it('refetches banners when the client locale differs from the server-rendered locale', async () => {
    const initialBanners = [
      {
        id: 'banner-en',
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
    ] satisfies PluginBanner[]
    mockFetchPluginBanners.mockResolvedValue([])

    const { EmbeddedMarketplace } = await import('../embedded')

    render(
      <EmbeddedMarketplace
        initialBanners={initialBanners}
        initialLocale="en-US"
        showInstallButton
        variant="home"
      />,
      { wrapper: Wrapper },
    )

    expect(await screen.findByText('Trending banners: 0')).toBeInTheDocument()
    expect(mockFetchPluginBanners).toHaveBeenCalledWith('zh-Hans')
  })

  it('does not request homepage banners for the default catalog variant', async () => {
    const { EmbeddedMarketplace } = await import('../embedded')

    render(<EmbeddedMarketplace variant="default" />, { wrapper: Wrapper })

    expect(screen.getByText('Trending banners: 0')).toBeInTheDocument()
    expect(mockFetchPluginBanners).not.toHaveBeenCalled()
  })
})
