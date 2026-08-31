import type { PluginBanner } from '@dify/contracts/marketplace'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import HomeTrending from '../home-trending'
import { HomeBannerSlide } from '../home-trending-slides'

const createBlogBanner = (id: string, title: string, sort: number): PluginBanner => ({
  id,
  style_type: 'blog',
  title,
  sort,
  language: 'en',
  content: {
    blog_title: title,
    subtitle: 'New Agent node support',
    description: 'Build agent workflows with the new Agent node.',
    link: 'https://dify.ai/blog',
    link_target_type: 'blog',
  },
})

const blogBanner = createBlogBanner('blog', 'Dify v1.9 new launch', 0)
const adBanner: PluginBanner = {
  id: 'ad',
  style_type: 'ad',
  title: 'Partner campaign',
  sort: 1,
  language: 'en',
  content: {
    images: {
      desktop: '/api/v1/banners/images/banners/ad.png',
    },
    link: 'https://partner.example.com',
    alt_text: 'Partner campaign',
  },
}
const eventBanner: PluginBanner = {
  id: 'event',
  style_type: 'event',
  title: 'Launch event',
  sort: 2,
  language: 'en',
  content: {
    images: {
      desktop: '/api/v1/banners/images/banners/event.png',
    },
    link: 'https://dify.ai/event',
    alt_text: 'Launch event',
  },
}
const carouselBanners = [
  createBlogBanner('first', 'First banner', 0),
  createBlogBanner('second', 'Second banner', 1),
  createBlogBanner('third', 'Third banner', 2),
]

describe('Marketplace home trending layout', () => {
  it('keeps standalone mobile blog banners at the stacked 357px height', async () => {
    await page.viewport(600, 900)
    await render(
      <div data-marketplace-standalone className="w-[560px]">
        <div data-testid="blog-banner">
          <HomeBannerSlide banner={blogBanner} isMarketplacePlatform page="plugins" />
        </div>
      </div>,
    )

    const blogSlide = document.querySelector<HTMLElement>('[data-testid="blog-banner"] > a')!

    expect(blogSlide.getBoundingClientRect().height).toBe(357)
  })

  it('shows the standalone mobile event poster at the 800:721 delivery ratio', async () => {
    await page.viewport(600, 900)
    const screen = await render(
      <div data-marketplace-standalone className="w-[360px]">
        <HomeBannerSlide banner={eventBanner} isMarketplacePlatform page="plugins" />
      </div>,
    )

    const slide = screen.getByRole('link', { name: 'Launch event' }).element()
    const box = slide.getBoundingClientRect()
    const artwork = slide.querySelector('img')

    expect(box.height).toBeCloseTo((box.width * 721) / 800, 1)
    expect(artwork).not.toBeNull()
    expect(getComputedStyle(artwork!).objectFit).toBe('contain')
    expect(getComputedStyle(artwork!).objectPosition).toBe('0% 50%')
  })

  it('keeps event and ad artwork left-aligned so desktop cropping stays on the right', async () => {
    await page.viewport(1000, 900)
    const screen = await render(
      <div data-marketplace-standalone className="w-[960px]">
        <HomeBannerSlide banner={adBanner} isMarketplacePlatform page="plugins" />
        <HomeBannerSlide banner={eventBanner} isMarketplacePlatform page="plugins" />
      </div>,
    )

    for (const name of ['Partner campaign', 'Launch event']) {
      const artwork = screen.getByRole('link', { name }).element().querySelector('img')

      expect(artwork).not.toBeNull()
      expect(getComputedStyle(artwork!).objectFit).toBe('cover')
      expect(getComputedStyle(artwork!).objectPosition).toBe('0% 50%')
    }
  })

  it('keeps blog artwork at 400px on desktop so shrinking clips the right', async () => {
    await page.viewport(1200, 900)
    const screen = await render(
      <div className="w-[900px]">
        <HomeBannerSlide banner={blogBanner} isMarketplacePlatform page="plugins" />
      </div>,
    )

    const artwork = screen.getByRole('link').element().querySelector('img')

    expect(artwork).not.toBeNull()
    expect(artwork!.getBoundingClientRect().width).toBe(400)
    expect(getComputedStyle(artwork!).objectFit).toBe('cover')
    expect(getComputedStyle(artwork!).objectPosition).toBe('0% 50%')
  })

  it('keeps desktop event artwork at least 1200px wide so overflow clips the right', async () => {
    await page.viewport(1000, 900)
    const screen = await render(
      <div data-marketplace-standalone className="w-[900px]">
        <HomeBannerSlide banner={eventBanner} isMarketplacePlatform page="plugins" />
      </div>,
    )

    const artwork = screen
      .getByRole('link', { name: 'Launch event' })
      .element()
      .querySelector('img')

    expect(artwork).not.toBeNull()
    expect(artwork!.getBoundingClientRect().width).toBeGreaterThanOrEqual(1200)
    expect(getComputedStyle(artwork!).objectPosition).toBe('0% 50%')
  })

  it('keeps the blog artwork left corners rounded when its image is cropped', async () => {
    const screen = await render(
      <div className="w-[600px]">
        <HomeBannerSlide banner={blogBanner} isMarketplacePlatform page="plugins" />
      </div>,
    )

    const artwork = screen.getByRole('link').element().querySelector('img')

    expect(artwork).not.toBeNull()
    expect(getComputedStyle(artwork!).borderTopLeftRadius).toBe('16px')
    expect(getComputedStyle(artwork!).borderBottomLeftRadius).toBe('16px')
  })

  it('moves forwards into the first slide clone before resetting the loop', async () => {
    const screen = await render(
      <HomeTrending banners={carouselBanners} isMarketplacePlatform page="plugins" />,
    )

    await screen.getByRole('button', { name: 'Third banner' }).click()
    await new Promise((resolve) => setTimeout(resolve, 450))

    const track = document.querySelector<HTMLElement>('[data-carousel-track]')!
    const progress = document.querySelector<HTMLElement>('[data-carousel-progress]')!
    const progressAnimation = progress.getAnimations()[0]
    expect(progressAnimation).toBeDefined()
    progressAnimation!.finish()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.getByRole('button', { name: 'Third banner' }).element()).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(track.style.transform).toContain('-300%')
    expect(track.querySelector('[data-carousel-loop-clone]')).toBeInTheDocument()

    await new Promise((resolve) => setTimeout(resolve, 450))

    expect(screen.getByRole('button', { name: 'First banner' }).element()).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(track.style.transform).toBe('translate3d(0%, 0px, 0px)')
    expect(track.querySelector('[data-carousel-loop-clone]')).not.toBeInTheDocument()
  })
})
