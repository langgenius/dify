import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import { preserveStickySearchScroll } from '../preserve-sticky-search-scroll'

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

describe('Sticky search scroll guard', () => {
  it('keeps the scroll position when Chromium focuses the in-flow sticky input', async () => {
    await page.viewport(1280, 900)

    const screen = await render(
      <div id={MARKETPLACE_CONTAINER_ID} style={{ height: 320, overflowY: 'auto' }}>
        <div style={{ height: 48, flexShrink: 0 }}>Header</div>
        <div style={{ height: 180, flexShrink: 0 }}>Hero</div>
        <div
          data-testid="search-root"
          style={{ position: 'sticky', top: 6, height: 36, marginTop: -36 }}
        >
          <input aria-label="Search plugins or templates" style={{ height: 36, width: '100%' }} />
        </div>
        <div style={{ height: 900, flexShrink: 0 }}>Catalog</div>
      </div>,
    )

    const container = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const searchRoot = screen.getByTestId('search-root').element()
    const input = screen.getByRole('textbox', { name: 'Search plugins or templates' }).element()

    const stop = preserveStickySearchScroll(searchRoot as HTMLElement, container)
    container.scrollTop = 400
    container.dispatchEvent(new Event('scroll'))
    await nextFrame()

    const scrollTopBefore = container.scrollTop
    HTMLInputElement.prototype.focus.call(input)
    await nextFrame()

    expect(container.scrollTop).toBe(scrollTopBefore)
    stop()
  })
})
