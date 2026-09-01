import type { PluginBanner } from '@dify/contracts/marketplace'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import HomeTrending from '../home-trending'

const createBanner = (id: string, title: string, sort: number): PluginBanner => ({
  id,
  style_type: 'blog',
  title,
  sort,
  language: 'en',
  content: {
    blog_title: title,
    subtitle: `${title} subtitle`,
    description: `${title} description`,
    link: `https://example.com/${id}`,
    link_target_type: 'blog',
  },
})

const banners = [
  createBanner('first', 'First banner', 0),
  createBanner('second', 'Second banner', 1),
  createBanner('third', 'Third banner', 2),
]

const dispatchTouchPointer = (
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: Pick<PointerEventInit, 'clientX' | 'clientY' | 'pointerId'>,
) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerType: 'touch',
      ...init,
    }),
  )

describe('Marketplace home trending mobile swipe', () => {
  it('switches in both directions without activating a dragged link or clearing Pause', async () => {
    await page.viewport(600, 900)
    const screen = await render(
      <div data-marketplace-standalone>
        <HomeTrending banners={banners} isMarketplacePlatform page="plugins" />
      </div>,
    )

    const firstSlideLocator = screen.getByRole('group', { name: 'First banner' })
    const secondSlideLocator = screen.getByRole('group', {
      name: 'Second banner',
      includeHidden: true,
    })
    const firstSlide = firstSlideLocator.element()
    const firstLink = firstSlide.querySelector<HTMLAnchorElement>('a')!

    dispatchTouchPointer(firstSlide, 'pointerdown', {
      pointerId: 1,
      clientX: 480,
      clientY: 160,
    })
    dispatchTouchPointer(firstSlide, 'pointermove', {
      pointerId: 1,
      clientX: 300,
      clientY: 166,
    })
    await expect.element(secondSlideLocator).toBeVisible()
    dispatchTouchPointer(firstSlide, 'pointerup', {
      pointerId: 1,
      clientX: 300,
      clientY: 166,
    })
    const clickWasNotCanceled = firstLink.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )

    expect(clickWasNotCanceled).toBe(false)
    await expect
      .element(screen.getByRole('button', { name: 'Second banner' }))
      .toHaveAttribute('aria-current', 'true')
    await screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPause' }).click()

    const secondSlide = secondSlideLocator.element()
    dispatchTouchPointer(secondSlide, 'pointerdown', {
      pointerId: 2,
      clientX: 260,
      clientY: 160,
    })
    dispatchTouchPointer(secondSlide, 'pointermove', {
      pointerId: 2,
      clientX: 440,
      clientY: 166,
    })
    dispatchTouchPointer(secondSlide, 'pointerup', {
      pointerId: 2,
      clientX: 440,
      clientY: 166,
    })

    await expect
      .element(screen.getByRole('button', { name: 'First banner' }))
      .toHaveAttribute('aria-current', 'true')
    await expect
      .element(screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPlay' }))
      .toBeInTheDocument()
  })

  it('suppresses the trailing click when a horizontal drag is pulled back before release', async () => {
    await page.viewport(600, 900)
    const screen = await render(
      <div data-marketplace-standalone>
        <HomeTrending banners={banners} isMarketplacePlatform page="plugins" />
      </div>,
    )
    const firstSlide = screen.getByRole('group', { name: 'First banner' }).element()
    const firstLink = firstSlide.querySelector<HTMLAnchorElement>('a')!

    dispatchTouchPointer(firstSlide, 'pointerdown', {
      pointerId: 1,
      clientX: 400,
      clientY: 160,
    })
    dispatchTouchPointer(firstSlide, 'pointermove', {
      pointerId: 1,
      clientX: 280,
      clientY: 164,
    })
    dispatchTouchPointer(firstSlide, 'pointermove', {
      pointerId: 1,
      clientX: 396,
      clientY: 162,
    })
    dispatchTouchPointer(firstSlide, 'pointerup', {
      pointerId: 1,
      clientX: 396,
      clientY: 162,
    })

    expect(
      firstLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    ).toBe(false)
    await expect
      .element(screen.getByRole('button', { name: 'First banner' }))
      .toHaveAttribute('aria-current', 'true')
  })

  it('keeps vertical gestures on the current slide and ignores desktop touch input', async () => {
    await page.viewport(600, 900)
    let screen = await render(
      <div data-marketplace-standalone>
        <HomeTrending banners={banners} isMarketplacePlatform page="plugins" />
      </div>,
    )
    let activeSlide = screen.getByRole('group', { name: 'First banner' }).element()

    dispatchTouchPointer(activeSlide, 'pointerdown', {
      pointerId: 1,
      clientX: 300,
      clientY: 120,
    })
    dispatchTouchPointer(activeSlide, 'pointermove', {
      pointerId: 1,
      clientX: 270,
      clientY: 300,
    })
    dispatchTouchPointer(activeSlide, 'pointerup', {
      pointerId: 1,
      clientX: 270,
      clientY: 300,
    })

    await expect
      .element(screen.getByRole('button', { name: 'First banner' }))
      .toHaveAttribute('aria-current', 'true')

    screen.unmount()
    await page.viewport(1000, 900)
    screen = await render(
      <div data-marketplace-standalone>
        <HomeTrending banners={banners} isMarketplacePlatform page="plugins" />
      </div>,
    )
    activeSlide = screen.getByRole('group', { name: 'First banner' }).element()

    dispatchTouchPointer(activeSlide, 'pointerdown', {
      pointerId: 2,
      clientX: 480,
      clientY: 160,
    })
    dispatchTouchPointer(activeSlide, 'pointermove', {
      pointerId: 2,
      clientX: 260,
      clientY: 160,
    })
    dispatchTouchPointer(activeSlide, 'pointerup', {
      pointerId: 2,
      clientX: 260,
      clientY: 160,
    })

    await expect
      .element(screen.getByRole('button', { name: 'First banner' }))
      .toHaveAttribute('aria-current', 'true')
  })
})
