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
  // Advance only the autoplay wait. Native finish and track transition events
  // must still return the carousel from the loop clone to the first slide.
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

      const track = document.querySelector<HTMLElement>('[data-carousel-track]')!
      const transitions: TransitionEvent[] = []
      const recordTransition = (event: TransitionEvent) => {
        if (event.target === track && event.propertyName === 'transform') transitions.push(event)
      }
      track.addEventListener('transitionend', recordTransition)

      try {
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

        await expect.poll(() => transitions.length).toBe(1)
        expect(transitions[0]!.isTrusted).toBe(true)
        expect(transitions[0]!.elapsedTime).toBeCloseTo(0.4, 2)
        transitions.length = 0

        const progress = document.querySelector('[data-carousel-progress]')!.getAnimations()[0]!
        expect(progress.playState).toBe('running')
        expect(progress.effect!.getTiming().duration).toBe(5000)
        let autoplayFinished: AnimationPlaybackEvent | undefined
        progress.addEventListener(
          'finish',
          (event) => {
            autoplayFinished = event
          },
          { once: true },
        )
        progress.currentTime = 5000

        await expect
          .poll(() =>
            screen
              .getByRole('button', { name: 'First banner' })
              .element()
              .getAttribute('aria-current'),
          )
          .toBe('true')

        await expectSlideInViewport('First banner')
        expect(screen.getByRole('group', { name: 'First banner' }).element()).not.toHaveAttribute(
          'inert',
        )
        expect(autoplayFinished?.isTrusted).toBe(true)
        expect(transitions).toHaveLength(1)
        expect(transitions[0]!.isTrusted).toBe(true)
        expect(transitions[0]!.elapsedTime).toBeCloseTo(0.4, 2)
      } finally {
        track.removeEventListener('transitionend', recordTransition)
      }
    },
  )
})
