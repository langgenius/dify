const LARGE_SCROLL_JUMP_PX = 16

const canScrollY = (element: Element, deltaY: number) => {
  const { overflowY } = getComputedStyle(element)
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false
  const maxScrollTop = element.scrollHeight - element.clientHeight
  if (maxScrollTop <= 0) return false
  if (deltaY > 0) return element.scrollTop < maxScrollTop - 1
  if (deltaY < 0) return element.scrollTop > 1
  return false
}

/**
 * Sticky search sits in document flow below the hero, then visually pins in the
 * header. Focusing or typing in that input makes Chromium scroll the layout box
 * into view, which unpins the search and looks like the page rolling down.
 * Remember the scroll position and snap back when a focused search input causes
 * a large jump. Visitor-initiated movement (wheel, touch, scrollbar) must still
 * scroll the page while the field is focused. The suggestions popup is portaled
 * onto `document.body`, so leftover wheel delta is forwarded to the page
 * scroller when the popup cannot consume it.
 */
export function preserveStickySearchScroll(searchRoot: HTMLElement, container: HTMLElement) {
  let stableScrollTop = container.scrollTop
  let suppressing = false
  let visitorScrolling = false

  const remember = () => {
    if (!suppressing) stableScrollTop = container.scrollTop
  }

  const restore = () => {
    if (container.scrollTop === stableScrollTop) return
    suppressing = true
    container.scrollTop = stableScrollTop
    requestAnimationFrame(() => {
      suppressing = false
    })
  }

  const markVisitorScroll = () => {
    visitorScrolling = true
  }

  const onWindowWheel = (event: WheelEvent) => {
    if (!searchRoot.contains(document.activeElement) || event.deltaY === 0) return
    markVisitorScroll()
    if (!(event.target instanceof Node) || container.contains(event.target)) return

    let node: Element | null =
      event.target instanceof Element ? event.target : event.target.parentElement
    while (node && node !== document.documentElement) {
      if (node === container) return
      if (canScrollY(node, event.deltaY)) return
      node = node.parentElement
    }

    event.preventDefault()
    container.scrollTop += event.deltaY
  }

  const onScroll = () => {
    if (suppressing) return
    if (searchRoot.contains(document.activeElement) && !visitorScrolling) {
      if (Math.abs(container.scrollTop - stableScrollTop) > LARGE_SCROLL_JUMP_PX) {
        restore()
        return
      }
    }
    remember()
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || !searchRoot.contains(event.target)) return
    visitorScrolling = false
    remember()
    suppressing = true
    requestAnimationFrame(() => {
      restore()
      suppressing = false
    })
  }

  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof Node) || !searchRoot.contains(event.target)) return
    visitorScrolling = false
    restore()
    requestAnimationFrame(restore)
  }

  const onInput = (event: Event) => {
    if (!(event.target instanceof Node) || !searchRoot.contains(event.target)) return
    restore()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return
    remember()
    suppressing = true
    requestAnimationFrame(() => {
      suppressing = false
    })
  }

  const patchInputFocus = (input: HTMLInputElement) => {
    if (input.dataset.marketplaceSearchFocus === 'patched') return
    input.dataset.marketplaceSearchFocus = 'patched'
    const nativeFocus = input.focus.bind(input)
    input.focus = (options) => nativeFocus({ ...options, preventScroll: true })
  }

  searchRoot.querySelectorAll('input').forEach((input) => {
    patchInputFocus(input)
  })
  const observer = new MutationObserver(() => {
    searchRoot.querySelectorAll('input').forEach((input) => {
      patchInputFocus(input)
    })
  })
  observer.observe(searchRoot, { childList: true, subtree: true })

  const onContainerPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || searchRoot.contains(event.target)) return
    markVisitorScroll()
  }

  container.addEventListener('scroll', onScroll, { passive: true })
  container.addEventListener('touchmove', markVisitorScroll, { passive: true })
  container.addEventListener('pointerdown', onContainerPointerDown)
  searchRoot.addEventListener('pointerdown', onPointerDown, true)
  searchRoot.addEventListener('focusin', onFocusIn)
  searchRoot.addEventListener('input', onInput, true)
  window.addEventListener('wheel', onWindowWheel, { passive: false })
  window.addEventListener('keydown', onKeyDown, true)

  return () => {
    observer.disconnect()
    container.removeEventListener('scroll', onScroll)
    container.removeEventListener('touchmove', markVisitorScroll)
    container.removeEventListener('pointerdown', onContainerPointerDown)
    searchRoot.removeEventListener('pointerdown', onPointerDown, true)
    searchRoot.removeEventListener('focusin', onFocusIn)
    searchRoot.removeEventListener('input', onInput, true)
    window.removeEventListener('wheel', onWindowWheel)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}
