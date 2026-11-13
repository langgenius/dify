import type { PluginBanner } from '@dify/contracts/marketplace'
import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { render } from 'vitest-browser-react'
import HomeTrending from '../home-trending'

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
    cover_image: '/api/v1/banners/images/banners/blog-cover.png',
    link: 'https://dify.ai/blog',
    link_target_type: 'blog',
  },
})

const carouselBanners = [
  createBlogBanner('first', 'First banner', 0),
  createBlogBanner('second', 'Second banner', 1),
  createBlogBanner('third', 'Third banner', 2),
]

describe('Marketplace home trending loop', () => {
  // The unit spec stubs the autoplay animation and fires a synthetic
  // transitionend; only real rendering proves the track transition completes
  // and returns the carousel from the loop clone to the first slide.
  it.each(['ltr', 'rtl'] as const)(
    'wraps from the last banner back to the first visible slide in %s',
    async (direction) => {
      const screen = await render(
        <DirectionProvider direction={direction}>
          <div dir={direction}>
            <HomeTrending banners={carouselBanners} isMarketplacePlatform page="plugins" />
          </div>
        </DirectionProvider>,
      )

      await screen.getByRole('button', { name: 'Third banner' }).click()
      expect(screen.getByRole('button', { name: 'Third banner' }).element()).toHaveAttribute(
        'aria-current',
        'true',
      )

      const expectSlideInViewport = async (name: string) => {
        await expect
          .poll(() => {
            const viewport = document
              .querySelector('[data-home-trending-carousel-root]')!
              .getBoundingClientRect()
            const slide = screen.getByRole('group', { name }).element().getBoundingClientRect()
            return slide.left >= viewport.left - 1 && slide.right <= viewport.right + 1
          })
          .toBe(true)
      }
      await expectSlideInViewport('Third banner')

      await expect
        .poll(
          () =>
            screen
              .getByRole('button', { name: 'First banner' })
              .element()
              .getAttribute('aria-current'),
          { timeout: 8000 },
        )
        .toBe('true')

      await expectSlideInViewport('First banner')
      expect(screen.getByRole('group', { name: 'First banner' }).element()).not.toHaveAttribute(
        'inert',
      )
    },
  )
})
