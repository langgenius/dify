import type { PluginBanner } from '../banners'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import HomeTrending from '../home-trending'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: (namespace: string) => ({
      t: withSelectorKey((key: string) => `${namespace}.${key}`),
    }),
  }
})

vi.mock('@/app/components/plugins/base/badges/partner', () => ({
  default: () => <span data-testid="partner-badge" />,
}))

vi.mock('@/app/components/plugins/base/badges/verified', () => ({
  default: () => <span data-testid="verified-badge" />,
}))

const banners: PluginBanner[] = [
  {
    id: 'recommend',
    style_type: 'recommend',
    title: 'Trending',
    sort: 0,
    language: 'en',
    content: {
      theme_type: 'hottest',
      heading: 'Popular plugins',
      description: 'Chosen from real usage.',
      cards: [
        {
          item_type: 'plugin',
          item_id: 'langgenius/dropbox',
          display_name: 'Dropbox',
          icon_url: '/api/v1/plugins/langgenius/dropbox/icon',
          creator: 'langgenius',
          badges: ['partner', 'verified'],
          link: '/plugins/langgenius/dropbox',
          card_position: 0,
        },
        {
          item_type: 'plugin',
          item_id: 'langgenius/zapier',
          display_name: 'Zapier',
          link: '/plugins/langgenius/zapier',
          card_position: 1,
        },
        {
          item_type: 'plugin',
          item_id: 'langgenius/notion',
          display_name: 'Notion',
          link: '/plugins/langgenius/notion',
          card_position: 2,
        },
        {
          item_type: 'plugin',
          item_id: 'langgenius/slack',
          display_name: 'Slack',
          link: '/plugins/langgenius/slack',
          card_position: 3,
        },
      ],
    },
  },
  {
    id: 'blog',
    style_type: 'blog',
    title: 'Dify Updates',
    sort: 1,
    language: 'en',
    content: {
      blog_title: 'Dify v1.9 new launch',
      subtitle: 'New Agent node support',
      description: 'Build agent workflows with the new Agent node.',
      link: 'https://dify.ai/blog',
      link_target_type: 'blog',
    },
  },
  {
    id: 'event',
    style_type: 'event',
    title: 'Duck Duck Go',
    sort: 2,
    language: 'en',
    content: {
      images: {
        desktop: '/api/v1/banners/images/banners/duckduckgo.png',
        mobile: '/api/v1/banners/images/banners/duckduckgo-mobile.png',
      },
      link: 'https://marketplace.dify.ai/plugin/langgenius/duckduckgo',
      alt_text: 'DuckDuckGo plugin',
    },
  },
]

describe('HomeTrending', () => {
  it('renders and switches between the three API-backed banner layouts', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform />)

    expect(screen.getByRole('heading', { name: 'Popular plugins' })).toBeInTheDocument()
    const recommendationSlide = screen.getByRole('group', { name: 'Trending' })
    expect(
      within(recommendationSlide)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual(['Dropbox', 'Zapier', 'Notion', 'Slack'])

    await user.click(screen.getByRole('button', { name: 'Dify Updates' }))

    expect(screen.getByRole('heading', { name: 'Dify v1.9 new launch' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Read more about Dify v1.9 new launch',
      }),
    ).toHaveAttribute('href', 'https://dify.ai/blog')

    await user.click(screen.getByRole('button', { name: 'Duck Duck Go' }))

    expect(screen.getByRole('link', { name: 'DuckDuckGo plugin' })).toHaveAttribute(
      'href',
      'https://marketplace.dify.ai/plugin/langgenius/duckduckgo',
    )
  })

  it('switches to the selected slide from the pagination with the keyboard', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform />)

    const duckDuckGoButton = screen.getByRole('button', { name: 'Duck Duck Go' })

    duckDuckGoButton.focus()
    await user.keyboard('{Enter}')

    expect(duckDuckGoButton).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Trending' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('group', { name: 'Duck Duck Go' })).toHaveAttribute(
      'aria-hidden',
      'false',
    )
  })

  it('toggles the carousel between paused and playing states', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform />)

    const pauseButton = screen.getByRole('button', {
      name: 'plugin.marketplace.home.trendingPause',
    })

    pauseButton.focus()
    await user.keyboard('{Enter}')

    const playButton = screen.getByRole('button', {
      name: 'plugin.marketplace.home.trendingPlay',
    })

    playButton.focus()
    await user.keyboard(' ')

    expect(
      screen.getByRole('button', {
        name: 'plugin.marketplace.home.trendingPause',
      }),
    ).toBeInTheDocument()
  })

  it('starts with autoplay paused when reduced motion is enabled', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })

    render(<HomeTrending banners={banners} isMarketplacePlatform />)

    expect(
      screen.getByRole('button', {
        name: 'plugin.marketplace.home.trendingPlay',
      }),
    ).toBeInTheDocument()

    matchMedia.mockRestore()
  })

  it('renders no carousel when the API returns no banners', () => {
    render(<HomeTrending banners={[]} isMarketplacePlatform />)

    expect(
      screen.queryByRole('region', {
        name: 'plugin.marketplace.home.trendingTitle',
      }),
    ).not.toBeInTheDocument()
  })
})
