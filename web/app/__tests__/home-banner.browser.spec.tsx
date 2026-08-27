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
      <div data-testid="banner-host" style={{ width: 300 }}>
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
    // Chromium owns native tab order and focus transitions; happy-dom cannot prove either contract.
    const screen = await renderBanner()
    const pauseControl = screen.getByRole('button', { name: 'common.operation.pause' })
    await expect.element(pauseControl).toBeVisible()
    const pauseControlElement = pauseControl.element()

    await screen.getByRole('button', { name: 'Before carousel' }).click()
    await userEvent.tab()

    expect(pauseControlElement).toHaveFocus()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.play' }))
      .toBeVisible()

    await screen.getByRole('button', { name: 'After carousel' }).click()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.play' }))
      .toBeVisible()
  })

  it('keeps the whole carousel paused while the pointer moves between slides and controls', async () => {
    // Chromium hit testing is required to prove that moving onto the overlaid control stays in one hover boundary.
    const screen = await renderBanner()
    const carousel = screen.getByRole('region', { name: 'explore.banner.carouselLabel' })
    const pauseControl = screen.getByRole('button', { name: 'common.operation.pause' })
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

  it('resumes after a real pointer drag without desynchronizing the pause action', async () => {
    // Embla's pointer lifecycle depends on browser mouse events and cannot be reproduced faithfully in happy-dom.
    const screen = await renderBanner()
    const carousel = screen.getByRole('region', { name: 'explore.banner.carouselLabel' })
    const pauseControl = screen.getByRole('button', { name: 'common.operation.pause' })
    const slidesContainer = getSlidesContainer(carousel.element())
    await expect.element(pauseControl).toBeVisible()

    await userEvent.dragAndDrop(
      slidesContainer,
      screen.getByRole('button', { name: 'After carousel' }),
    )

    await expect.poll(() => slidesContainer.getAttribute('aria-live')).toBe('off')
    await expect.element(pauseControl).toBeVisible()
  })

  it('preserves an explicit pause after ResizeObserver reinitializes Embla', async () => {
    // A real ResizeObserver-driven Embla reInit is a browser lifecycle that happy-dom does not implement.
    const screen = await renderBanner()
    const carousel = screen.getByRole('region', { name: 'explore.banner.carouselLabel' })
    const slidesContainer = getSlidesContainer(carousel.element())
    const host = screen.getByTestId('banner-host').element()
    await screen.getByRole('button', { name: 'common.operation.pause' }).click()
    await userEvent.unhover(carousel)
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.play' }))
      .toBeVisible()

    const resized = new Promise<void>((resolve) => {
      const observer = new ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width >= 260) return
        observer.disconnect()
        resolve()
      })
      observer.observe(carousel.element())
    })
    host.style.width = '240px'
    await resized

    await expect
      .element(screen.getByRole('button', { name: 'common.operation.play' }))
      .toBeVisible()
    expect(slidesContainer).toHaveAttribute('aria-live', 'polite')
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
    const playControl = screen.getByRole('button', { name: 'common.operation.play' })
    await expect.element(playControl).toBeVisible()

    await playControl.click()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.pause' }))
      .toBeVisible()
    await userEvent.unhover(carousel)

    await expect.poll(() => slidesContainer.getAttribute('aria-live')).toBe('off')
  })
})
