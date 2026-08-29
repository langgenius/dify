const LARGE_SCROLL_JUMP_PX = 16

/**
 * Sticky search sits in document flow below the hero, then visually pins in the
 * header. Focusing or typing in that input makes Chromium scroll the layout box
 * into view, which unpins the search and looks like the page rolling down.
 * Remember the scroll position and snap back when a focused search input causes
 * a large jump.
 */
export function preserveStickySearchScroll(searchRoot: HTMLElement, container: HTMLElement) {
  let stableScrollTop = container.scrollTop
  let suppressing = false

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

  const onScroll = () => {
    if (suppressing) return
    if (searchRoot.contains(document.activeElement)) {
      if (Math.abs(container.scrollTop - stableScrollTop) > LARGE_SCROLL_JUMP_PX) {
        restore()
        return
      }
    }
    remember()
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || !searchRoot.contains(event.target)) return
    remember()
    suppressing = true
    requestAnimationFrame(() => {
      restore()
      suppressing = false
    })
  }

  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof Node) || !searchRoot.contains(event.target)) return
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

  container.addEventListener('scroll', onScroll, { passive: true })
  searchRoot.addEventListener('pointerdown', onPointerDown, true)
  searchRoot.addEventListener('focusin', onFocusIn)
  searchRoot.addEventListener('input', onInput, true)
  window.addEventListener('keydown', onKeyDown, true)

  return () => {
    observer.disconnect()
    container.removeEventListener('scroll', onScroll)
    searchRoot.removeEventListener('pointerdown', onPointerDown, true)
    searchRoot.removeEventListener('focusin', onFocusIn)
    searchRoot.removeEventListener('input', onInput, true)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}
