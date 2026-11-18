import type { ComponentProps } from 'react'
import type { CarouselPage } from '../carousel'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import Carousel from '../carousel'

const pages: CarouselPage[] = Array.from({ length: 5 }, (_, index) => ({
  id: `page-${index + 1}`,
  content: (
    <label>
      Page {index + 1} draft
      <input defaultValue={`Draft ${index + 1}`} />
    </label>
  ),
}))
const nextName = 'plugin.marketplace.carousel.scrollNext'
const previousName = 'plugin.marketplace.carousel.scrollPrevious'
const pageName = (page: number) => `plugin.marketplace.carousel.goToPage:{"page":${page}}`

async function setup(props: Partial<ComponentProps<typeof Carousel>> = {}) {
  await page.viewport(800, 600)
  return render(
    <div style={{ width: 600, paddingTop: 50 }}>
      <button type="button">Before carousel</button>
      <Carousel pages={pages} ariaLabel="Featured tools" {...props} />
      <button type="button">After carousel</button>
    </div>,
  )
}
async function expectActivePage(screen: Awaited<ReturnType<typeof setup>>, page: number) {
  const input = screen.getByRole('textbox', { name: `Page ${page} draft` })
  await expect.element(input).toBeVisible()
  // Hit testing proves that the actual Embla slide is onscreen, beyond its ARIA selection.
  await expect
    .poll(() => {
      const element = input.element()
      const bounds = element.getBoundingClientRect()
      return (
        document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        ) === element
      )
    })
    .toBe(true)
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('keeps a visited page draft while real pagination loops and the page collection changes', async () => {
  const screen = await setup({ deferMountPages: true })
  await screen.getByRole('button', { name: pageName(4), exact: true }).click()
  await expectActivePage(screen, 4)
  const draft = screen.getByRole('textbox', { name: 'Page 4 draft' })
  await draft.fill('Keep this draft')
  await screen.getByRole('button', { name: nextName }).click()
  await expectActivePage(screen, 5)
  await screen.getByRole('button', { name: nextName }).click()
  await expectActivePage(screen, 1)
  await screen.getByRole('button', { name: previousName }).click()
  await expectActivePage(screen, 5)
  await screen.getByRole('button', { name: previousName }).click()
  await expect.element(draft).toHaveValue('Keep this draft')
  await screen.rerender(
    <div style={{ width: 600, paddingTop: 50 }}>
      <button type="button">Before carousel</button>
      <Carousel pages={pages.slice(0, 4)} ariaLabel="Featured tools" deferMountPages />
      <button type="button">After carousel</button>
    </div>,
  )
  await expect
    .element(screen.getByRole('button', { name: pageName(5), exact: true }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: pageName(4), exact: true }).click()
  await expect.element(draft).toHaveValue('Keep this draft')
})

it('keeps offscreen page controls out of the native Tab order', async () => {
  const screen = await setup({ showNavigation: false })
  await screen.getByRole('button', { name: 'Before carousel' }).click()
  await userEvent.tab()
  await expect.element(screen.getByRole('textbox', { name: 'Page 1 draft' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'After carousel' })).toHaveFocus()
  await expect
    .element(screen.getByRole('textbox', { name: 'Page 2 draft' }))
    .not.toBeInTheDocument()
})

it('rotates real pages until keyboard focus enters and keeps rotation stopped after focus leaves', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const screen = await setup({ autoPlay: true, autoPlayInterval: 1000, pauseWhenOffscreen: true })
  await expectActivePage(screen, 1)
  await new Promise(requestAnimationFrame)
  await vi.advanceTimersByTimeAsync(1000)
  await expectActivePage(screen, 2)
  screen.getByRole('button', { name: 'Before carousel' }).element().focus()
  await userEvent.tab()
  // Pagination is the first control inside the real carousel.
  await expect.element(screen.getByRole('button', { name: pageName(1), exact: true })).toHaveFocus()
  await vi.advanceTimersByTimeAsync(2000)
  // Sample now: eventual matching could accept another full autoplay cycle.
  expect(screen.getByRole('textbox', { name: 'Page 2 draft' }).element().checkVisibility()).toBe(
    true,
  )
  screen.getByRole('button', { name: 'After carousel' }).element().focus()
  await vi.advanceTimersByTimeAsync(2000)
  expect(screen.getByRole('textbox', { name: 'Page 2 draft' }).element().checkVisibility()).toBe(
    true,
  )
})

it('pauses viewport-managed rotation while hovered or scrolled out, then resumes when visible', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await page.viewport(800, 600)
  const screen = await render(
    <div
      id={MARKETPLACE_CONTAINER_ID}
      role="region"
      aria-label="Marketplace viewport"
      style={{ width: 600, height: 220, overflow: 'auto' }}
    >
      <div style={{ paddingTop: 50 }}>
        <Carousel
          pages={pages}
          ariaLabel="Featured tools"
          autoPlay
          autoPlayInterval={1000}
          pauseWhenOffscreen
        />
      </div>
      <div style={{ height: 500 }} />
    </div>,
  )
  const carousel = screen.getByRole('region', { name: 'Featured tools' })
  const viewport = screen.getByRole('region', { name: 'Marketplace viewport' })
  await expectActivePage(screen, 1)
  // A real frame lets Chromium deliver the initial intersection record.
  await new Promise(requestAnimationFrame)
  await vi.advanceTimersByTimeAsync(1000)
  await expectActivePage(screen, 2)
  await carousel.hover()
  await vi.advanceTimersByTimeAsync(2000)
  expect(screen.getByRole('textbox', { name: 'Page 2 draft' }).element().checkVisibility()).toBe(
    true,
  )
  await userEvent.unhover(carousel)
  await vi.advanceTimersByTimeAsync(1000)
  const third = screen.getByRole('textbox', { name: 'Page 3 draft' })
  await expectActivePage(screen, 3)
  // boundary: the test iframe cannot background its browser tab; supply the document visibility signal.
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(2000)
  expect(third.element().checkVisibility()).toBe(true)
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  viewport.element().scrollTo({ top: 300 })
  await expect
    .poll(
      () =>
        carousel.element().getBoundingClientRect().bottom <=
        viewport.element().getBoundingClientRect().top,
    )
    .toBe(true)
  await new Promise(requestAnimationFrame)
  await vi.advanceTimersByTimeAsync(2000)
  expect(third.element().checkVisibility()).toBe(true)
  viewport.element().scrollTo({ top: 0 })
  await expect.poll(() => viewport.element().scrollTop).toBe(0)
  await new Promise(requestAnimationFrame)
  await vi.advanceTimersByTimeAsync(1000)
  await expectActivePage(screen, 4)
})

it.each([false, true])(
  'keeps a single-page carousel stable with managed rotation=%s',
  async (pauseWhenOffscreen) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const screen = await setup({
      pages: pages.slice(0, 1),
      autoPlay: true,
      autoPlayInterval: 1000,
      pauseWhenOffscreen,
      showSinglePageNavigation: true,
    })
    await expect.element(screen.getByRole('button', { name: nextName })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: previousName })).toBeDisabled()
    await vi.advanceTimersByTimeAsync(2000)
    await expect
      .element(screen.getByRole('textbox', { name: 'Page 1 draft' }))
      .toHaveValue('Draft 1')
  },
)

// boundary: Browser Mode cannot toggle the host OS motion preference; only its media-query signal is supplied.
function motionPreference(initial: boolean) {
  let reduced = initial
  const original = window.matchMedia.bind(window)
  const signal = new EventTarget()
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    query === '(prefers-reduced-motion: reduce)'
      ? (Object.defineProperties(signal, {
          matches: { configurable: true, get: () => reduced },
          media: { configurable: true, value: query },
        }) as MediaQueryList)
      : original(query),
  )
  return (value: boolean) => {
    reduced = value
    signal.dispatchEvent(
      new MediaQueryListEvent('change', {
        matches: value,
        media: '(prefers-reduced-motion: reduce)',
      }),
    )
  }
}

it.each([false, true])(
  'honors reduced motion with real autoplay (managed=%s)',
  async (pauseWhenOffscreen) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const setReducedMotion = motionPreference(true)
    const screen = await setup({ autoPlay: true, autoPlayInterval: 1000, pauseWhenOffscreen })
    await expectActivePage(screen, 1)
    await new Promise(requestAnimationFrame)
    await vi.advanceTimersByTimeAsync(2000)
    expect(screen.getByRole('textbox', { name: 'Page 1 draft' }).element().checkVisibility()).toBe(
      true,
    )
    setReducedMotion(false)
    await vi.advanceTimersByTimeAsync(1000)
    await expectActivePage(screen, 2)
  },
)
