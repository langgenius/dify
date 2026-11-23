// Wait until the active modal releases its background before opening or focusing tour UI.
export function waitForAccessibleElement(element: HTMLElement, onReady: () => void) {
  let observer: MutationObserver | undefined
  function check() {
    observer?.disconnect()
    const boundary = element.closest('[aria-hidden="true"], [inert]')
    if (boundary) {
      observer ??= new MutationObserver(check)
      observer.observe(boundary, { attributeFilter: ['aria-hidden', 'inert'] })
    } else {
      onReady()
    }
  }
  check()
  return () => observer?.disconnect()
}
