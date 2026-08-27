import type { PluginBanner } from '@dify/contracts/marketplace'
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
const carouselBanners = [
  createBlogBanner('first', 'First banner', 0),
  createBlogBanner('second', 'Second banner', 1),
  createBlogBanner('third', 'Third banner', 2),
]

describe('Marketplace home trending layout', () => {
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
