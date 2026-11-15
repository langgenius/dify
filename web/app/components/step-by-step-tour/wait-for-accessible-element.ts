// An overlay that opens behind an existing modal must wait before creating its own body portal.
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
