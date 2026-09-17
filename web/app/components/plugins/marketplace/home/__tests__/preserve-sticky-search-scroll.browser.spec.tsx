import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import { preserveStickySearchScroll } from '../preserve-sticky-search-scroll'

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const SearchPage = ({ popup }: { popup?: boolean }) => (
  <>
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
    </div>
    {popup ? (
      <div
        data-testid="search-popup"
        style={{
          height: 80,
          overflowY: 'auto',
          position: 'fixed',
          top: 50,
          left: 100,
          width: 200,
        }}
      >
        Short
      </div>
    ) : null}
  </>
)

describe('Sticky search scroll guard', () => {
  it('keeps the scroll position when Chromium focuses the in-flow sticky input', async () => {
    await page.viewport(1280, 900)

    const screen = await render(<SearchPage />)
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

  it('keeps visitor-initiated scroll after typing in the sticky search', async () => {
    await page.viewport(1280, 900)

    const screen = await render(<SearchPage />)
    const container = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const searchRoot = screen.getByTestId('search-root').element()
    const input = screen.getByRole('textbox', { name: 'Search plugins or templates' }).element()

    const stop = preserveStickySearchScroll(searchRoot as HTMLElement, container)
    container.scrollTop = 400
    container.dispatchEvent(new Event('scroll'))
    await nextFrame()

    input.focus()
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'open' }))
    await nextFrame()

    expect(container.scrollTop).toBe(400)

    container.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }))
    container.scrollTop = 520
    container.dispatchEvent(new Event('scroll'))
    await nextFrame()

    expect(container.scrollTop).toBe(520)
    stop()
  })

  it('scrolls the page when the visitor wheels over a portaled popup that cannot scroll', async () => {
    await page.viewport(1280, 900)

    const screen = await render(<SearchPage popup />)
    const container = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    const searchRoot = screen.getByTestId('search-root').element()
    const input = screen.getByRole('textbox', { name: 'Search plugins or templates' }).element()
    const popup = screen.getByTestId('search-popup').element()

    const stop = preserveStickySearchScroll(searchRoot as HTMLElement, container)
    container.scrollTop = 400
    container.dispatchEvent(new Event('scroll'))
    await nextFrame()

    input.focus()
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'open' }))
    await nextFrame()

    popup.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
    await nextFrame()

    expect(container.scrollTop).toBe(520)
    stop()
  })
})
