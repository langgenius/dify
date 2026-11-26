import type { PluginBanner } from '@dify/contracts/marketplace'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const listBanners = vi.hoisted(() => vi.fn())

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => 'zh-Hans',
}))

vi.mock('@/service/marketplace', async (importOriginal) => {
  const { withMarketplaceResponses } = await import('@/test/marketplace-service')
  return withMarketplaceResponses(await importOriginal(), { banners: { list: listBanners } })
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
    listBanners.mockResolvedValue({
      data: {
        banners: [
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
        ] satisfies PluginBanner[],
      },
    })

    const { EmbeddedMarketplace } = await import('../embedded')

    render(<EmbeddedMarketplace showInstallButton variant="home" />, { wrapper: Wrapper })

    expect(await screen.findByText('Trending banners: 1')).toBeInTheDocument()
    expect(screen.getByText('Install enabled')).toBeInTheDocument()
    expect(listBanners).toHaveBeenCalledWith(
      { query: { page: 'plugins', language: 'zh-Hans' } },
      expect.anything(),
    )
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
    expect(listBanners).not.toHaveBeenCalled()
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
    listBanners.mockResolvedValue({ data: { banners: [] } })

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
    expect(listBanners).toHaveBeenCalledWith(
      { query: { page: 'plugins', language: 'zh-Hans' } },
      expect.anything(),
    )
  })

  it('does not request homepage banners for the default catalog variant', async () => {
    const { EmbeddedMarketplace } = await import('../embedded')

    render(<EmbeddedMarketplace variant="default" />, { wrapper: Wrapper })

    expect(screen.getByText('Trending banners: 0')).toBeInTheDocument()
    expect(listBanners).not.toHaveBeenCalled()
  })
})
