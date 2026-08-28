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

describe('Marketplace mobile search layout', () => {
  it('keeps the sticky header brand and actions above the search while scrolling', async () => {
    await page.viewport(390, 844)

    const screen = await render(
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

    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const header = screen.getByRole('banner').element()
    const brand = screen.getByRole('link', { name: 'Dify Marketplace' }).element()
    const signIn = screen.getByRole('button', { name: 'Sign in' }).element()
    const searchInput = screen
      .getByRole('textbox', { name: 'Search plugins or templates' })
      .element()

    scrollContainer.scrollTop =
      searchInput.getBoundingClientRect().top - header.getBoundingClientRect().top - 6
    scrollContainer.dispatchEvent(new Event('scroll'))
    await nextFrame()

    const searchRect = searchInput.getBoundingClientRect()
    const assertHeaderTargetIsClickable = (target: Element) => {
      const targetRect = target.getBoundingClientRect()
      const x = targetRect.left + targetRect.width / 2
      const overlapTop = Math.max(targetRect.top, searchRect.top)
      const overlapBottom = Math.min(targetRect.bottom, searchRect.bottom)
      const y = overlapTop + (overlapBottom - overlapTop) / 2

      expect(overlapBottom).toBeGreaterThan(overlapTop)
      expect(searchRect.left).toBeLessThan(x)
      expect(searchRect.right).toBeGreaterThan(x)
      expect(target.contains(document.elementFromPoint(x, y))).toBe(true)
    }

    assertHeaderTargetIsClickable(brand)
    assertHeaderTargetIsClickable(signIn)
  })
})
