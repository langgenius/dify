import { fireEvent } from '@testing-library/react'
import { preserveStickySearchScroll } from '../preserve-sticky-search-scroll'

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const setup = () => {
  document.body.innerHTML = `
    <div id="container"><div id="search-root"><input /></div></div>
    <div id="popup">Short</div>
  `
  const container = document.getElementById('container')!
  const input = container.querySelector('input')!
  const stop = preserveStickySearchScroll(document.getElementById('search-root')!, container)

  container.scrollTop = 400
  fireEvent.scroll(container)
  input.focus()
  fireEvent.input(input, { target: { value: 'open' } })

  return { container, popup: document.getElementById('popup')!, stop }
}

describe('preserveStickySearchScroll', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps visitor-initiated scroll after typing in the sticky search', async () => {
    const { container, stop } = setup()
    await nextFrame()
    expect(container.scrollTop).toBe(400)

    fireEvent.wheel(container, { deltaY: 120 })
    container.scrollTop = 520
    fireEvent.scroll(container)
    await nextFrame()

    expect(container.scrollTop).toBe(520)
    stop()
  })

  it('scrolls the page when the visitor wheels over a portaled popup that cannot scroll', async () => {
    const { container, popup, stop } = setup()
    await nextFrame()

    fireEvent.wheel(popup, { deltaY: 120 })

    expect(container.scrollTop).toBe(520)
    stop()
  })
})
