import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import HomeHeader from '../home-header'
import HomeSearch from '../home-search'
import { HomeShell } from '../home-shell'

vi.mock('@/public/marketplace/dify-marketplace-logo-dark.svg', () => ({
  default: { src: '/marketplace/dify-marketplace-logo-dark.svg' },
}))

vi.mock('@/public/marketplace/dify-marketplace-logo.svg', () => ({
  default: { src: '/marketplace/dify-marketplace-logo.svg' },
}))

vi.mock('../home-catalog-tabs', () => ({
  default: () => null,
}))

vi.mock('../home-creator-center', () => ({
  default: () => null,
}))

vi.mock('../home-guide', () => ({
  default: () => null,
}))

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

const isCenterClickable = (target: Element) => {
  const rect = target.getBoundingClientRect()
  const node = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  return Boolean(node && target.contains(node))
}

const renderMarketplaceHome = () =>
  render(
    <div id={MARKETPLACE_CONTAINER_ID} style={{ height: 320, overflowY: 'auto' }}>
      <HomeShell
        banners={[]}
        header={
          <HomeHeader actions={<button type="button">Sign in</button>} isMarketplacePlatform />
        }
        hero={<div aria-hidden style={{ height: 180, flexShrink: 0 }} />}
        isMarketplacePlatform
        navigation={<div aria-hidden style={{ height: 80, flexShrink: 0 }} />}
        page="plugins"
        search={
          <HomeSearch enableSearchShortcut={false}>
            <input
              aria-label="Search plugins or templates"
              style={{ display: 'block', height: 36, width: '100%' }}
            />
          </HomeSearch>
        }
      >
        <div aria-hidden style={{ height: 640, flexShrink: 0 }} />
      </HomeShell>
    </div>,
  )

describe('Marketplace mobile search layout', () => {
  it('pins the mobile search below the header without covering brand or actions', async () => {
    await page.viewport(390, 844)
    const screen = await renderMarketplaceHome()

    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const header = screen.getByRole('banner').element()
    const brand = screen.getByRole('link', { name: 'Dify Marketplace' }).element()
    const signIn = screen.getByRole('button', { name: 'Sign in' }).element()
    const searchInput = screen
      .getByRole('textbox', { name: 'Search plugins or templates' })
      .element()

    scrollContainer.scrollTop = 400
    scrollContainer.dispatchEvent(new Event('scroll'))
    await nextFrame()

    const headerRect = header.getBoundingClientRect()
    const searchRect = searchInput.getBoundingClientRect()

    expect(searchRect.top).toBeGreaterThanOrEqual(headerRect.bottom - 1)
    expect(searchRect.top).toBeLessThanOrEqual(headerRect.bottom + 2)
    expect(overlaps(searchRect, brand.getBoundingClientRect())).toBe(false)
    expect(overlaps(searchRect, signIn.getBoundingClientRect())).toBe(false)
    expect(isCenterClickable(brand)).toBe(true)
    expect(isCenterClickable(signIn)).toBe(true)
    expect(isCenterClickable(searchInput)).toBe(true)
  })

  it('keeps the desktop search in the header gap while scrolling', async () => {
    await page.viewport(1280, 900)
    const screen = await renderMarketplaceHome()

    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const header = screen.getByRole('banner').element()
    const searchInput = screen
      .getByRole('textbox', { name: 'Search plugins or templates' })
      .element()

    scrollContainer.scrollTop = 400
    scrollContainer.dispatchEvent(new Event('scroll'))
    await nextFrame()

    expect(
      searchInput.getBoundingClientRect().top - header.getBoundingClientRect().top,
    ).toBeCloseTo(6, 0)
  })

  it('keeps a search-results search below the header when there is no hero to overlap', async () => {
    await page.viewport(1280, 900)
    const screen = await render(
      <div id={MARKETPLACE_CONTAINER_ID} style={{ height: 320, overflowY: 'auto' }}>
        <HomeShell
          banners={[]}
          header={
            <HomeHeader actions={<button type="button">Sign in</button>} isMarketplacePlatform />
          }
          hero={null}
          isMarketplacePlatform
          navigation={null}
          page="plugins"
          search={
            <HomeSearch enableSearchShortcut={false} overlapHero={false}>
              <input
                aria-label="Search plugins or templates"
                style={{ display: 'block', height: 36, width: '100%' }}
              />
            </HomeSearch>
          }
        >
          <div aria-hidden style={{ height: 640, flexShrink: 0 }} />
        </HomeShell>
      </div>,
    )

    const header = screen.getByRole('banner').element()
    const searchInput = screen
      .getByRole('textbox', { name: 'Search plugins or templates' })
      .element()

    expect(searchInput.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      header.getBoundingClientRect().bottom - 1,
    )
    expect(searchInput.getBoundingClientRect().width).toBeGreaterThan(300)
  })

  it('does not jump the page when the stuck desktop search is focused or typed into', async () => {
    await page.viewport(1280, 900)
    const screen = await renderMarketplaceHome()

    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const header = screen.getByRole('banner').element()
    const searchInput = screen
      .getByRole('textbox', { name: 'Search plugins or templates' })
      .element()

    scrollContainer.scrollTop = 400
    scrollContainer.dispatchEvent(new Event('scroll'))
    await nextFrame()

    const scrollTopBefore = scrollContainer.scrollTop
    const inputTopBefore = searchInput.getBoundingClientRect().top
    expect(inputTopBefore - header.getBoundingClientRect().top).toBeCloseTo(6, 0)

    const searchLocator = screen.getByRole('textbox', { name: 'Search plugins or templates' })
    await searchLocator.click()
    await nextFrame()

    expect(scrollContainer.scrollTop).toBe(scrollTopBefore)
    expect(searchInput.getBoundingClientRect().top).toBeCloseTo(inputTopBefore)

    await searchLocator.fill('g')
    await nextFrame()

    expect(scrollContainer.scrollTop).toBe(scrollTopBefore)
    expect(searchInput.getBoundingClientRect().top).toBeCloseTo(inputTopBefore)
  })
})
