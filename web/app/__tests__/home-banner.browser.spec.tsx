import type { BannerResponse } from '@dify/contracts/api/console/explore/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Banner } from '@/features/home/banner/banner'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useSuspenseQuery: () => ({ data: { id: 'account-123' } }),
  }
})

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({}),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const banners: BannerResponse[] = [
  {
    id: 'banner-1',
    status: 'enabled',
    link: '',
    created_at: '2024-01-01T00:00:00Z',
    sort: 1,
    content: {
      category: 'Featured',
      title: 'First banner',
      description: 'First banner description',
      'img-src': 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
    },
  },
  {
    id: 'banner-2',
    status: 'enabled',
    link: '',
    created_at: '2024-01-01T00:00:00Z',
    sort: 2,
    content: {
      category: 'Featured',
      title: 'Second banner',
      description: 'Second banner description',
      'img-src': 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
    },
  },
]

async function renderBanner() {
  return render(
    <>
      <button type="button">Before carousel</button>
      <div style={{ width: 300 }}>
        <Banner banners={banners} />
      </div>
      <button type="button">After carousel</button>
    </>,
  )
}

function getSlidesContainer(carousel: Element) {
  const slidesContainer = carousel.querySelector<HTMLElement>('[data-banner-carousel-slides]')
  if (!slidesContainer) throw new Error('Banner slides container was not rendered')
  return slidesContainer
}

describe('Home banner browser interactions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('puts the rotation control first in the native tab order and keeps focus-triggered pauses', async () => {
    // Chromium owns native tab order, layout geometry, and focus transitions; happy-dom cannot prove these contracts.
    const screen = await renderBanner()
    const stopRotationControl = screen.getByRole('button', {
      name: 'explore.banner.stopRotation',
    })
    const firstPicker = screen.getByRole('button', { name: '01 First banner' })
    await expect.element(stopRotationControl).toBeVisible()
    const rotationControlElement = stopRotationControl.element()
    expect(rotationControlElement.getBoundingClientRect().left).toBeLessThan(
      firstPicker.element().getBoundingClientRect().left,
    )

    await screen.getByRole('button', { name: 'Before carousel' }).click()
    await userEvent.tab()

    expect(rotationControlElement).toHaveFocus()
    await expect
      .element(screen.getByRole('button', { name: 'explore.banner.startRotation' }))
      .toBeVisible()

    await userEvent.keyboard('{Space}')
    await expect
      .element(screen.getByRole('button', { name: 'explore.banner.stopRotation' }))
      .toBeVisible()

    await userEvent.tab()
    expect(firstPicker.element()).toHaveFocus()
    await expect
      .element(screen.getByRole('button', { name: 'explore.banner.stopRotation' }))
      .toBeVisible()
  })

  it('keeps the whole carousel paused while the pointer moves between slides and controls', async () => {
    // Chromium hit testing is required to prove that moving onto the overlaid control stays in one hover boundary.
    const screen = await renderBanner()
    const carousel = screen.getByRole('region', { name: 'explore.banner.carouselLabel' })
    const pauseControl = screen.getByRole('button', { name: 'explore.banner.stopRotation' })
    const slidesContainer = getSlidesContainer(carousel.element())
    await expect.element(pauseControl).toBeVisible()

    await screen.getByRole('button', { name: 'Before carousel' }).hover()
    await carousel.hover()
    await expect.poll(() => slidesContainer.getAttribute('aria-live')).toBe('polite')

    await pauseControl.hover()
    await expect.poll(() => slidesContainer.getAttribute('aria-live')).toBe('polite')
    await userEvent.unhover(carousel)

    await expect.poll(() => slidesContainer.getAttribute('aria-live')).toBe('off')
  })

  it('keeps an explicit pause after a real pointer drag released inside the carousel', async () => {
    // Embla's pointer lifecycle and owner-window timer depend on browser behavior that happy-dom cannot reproduce faithfully.
    const screen = await renderBanner()
    const carousel = screen.getByRole('region', { name: 'explore.banner.carouselLabel' })
    const stopRotationControl = screen.getByRole('button', {
      name: 'explore.banner.stopRotation',
    })
    const slidesContainer = getSlidesContainer(carousel.element())
    const slidesRect = slidesContainer.getBoundingClientRect()
    const firstSlide = screen.getByRole('group', { name: 'First banner' })
    const firstSlideElement = firstSlide.element()
    await stopRotationControl.click()
    await userEvent.unhover(carousel)
    await expect
      .element(screen.getByRole('button', { name: 'explore.banner.startRotation' }))
      .toBeVisible()

    vi.useFakeTimers()
    try {
      await userEvent.dragAndDrop(slidesContainer, slidesContainer, {
        sourcePosition: { x: slidesRect.width / 2 - 4, y: slidesRect.height / 2 },
        targetPosition: { x: slidesRect.width / 2 + 4, y: slidesRect.height / 2 },
        steps: 2,
      })
      await vi.advanceTimersByTimeAsync(1000)
      const firstSlideStateAfterDrag = firstSlideElement.getAttribute('aria-hidden')
      await vi.advanceTimersByTimeAsync(5001)
      expect(firstSlideElement.getAttribute('aria-hidden')).toBe(firstSlideStateAfterDrag)
    } finally {
      vi.useRealTimers()
    }

    expect(slidesContainer).toHaveAttribute('aria-live', 'polite')
    await expect
      .element(screen.getByRole('button', { name: 'explore.banner.startRotation' }))
      .toBeVisible()
  })

  it('keeps autoplay initialized but stopped for reduced motion so Play remains safe', async () => {
    // The real browser implementation is retained while the media-query result is emulated before Embla initializes.
    const nativeMatchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const mediaQueryList = nativeMatchMedia(query)
      if (query !== REDUCED_MOTION_QUERY) return mediaQueryList

      return {
        matches: true,
        media: mediaQueryList.media,
        onchange: null,
        addListener: mediaQueryList.addListener.bind(mediaQueryList),
        removeListener: mediaQueryList.removeListener.bind(mediaQueryList),
        addEventListener: mediaQueryList.addEventListener.bind(mediaQueryList),
        removeEventListener: mediaQueryList.removeEventListener.bind(mediaQueryList),
        dispatchEvent: mediaQueryList.dispatchEvent.bind(mediaQueryList),
      }
    })

    const screen = await renderBanner()
    const carousel = screen.getByRole('region', { name: 'explore.banner.carouselLabel' })
    const slidesContainer = getSlidesContainer(carousel.element())
    const playControl = screen.getByRole('button', { name: 'explore.banner.startRotation' })
    await expect.element(playControl).toBeVisible()

    await playControl.click()
    await expect
      .element(screen.getByRole('button', { name: 'explore.banner.stopRotation' }))
      .toBeVisible()
    await userEvent.unhover(carousel)

    await expect.poll(() => slidesContainer.getAttribute('aria-live')).toBe('off')
  })
})
