export function focusOnArrival(element: HTMLElement | null) {
  if (!element) return

  const doc = element.ownerDocument
  const focused = doc.activeElement
  if (focused && focused !== doc.body) return
  if (doc.defaultView?.matchMedia?.('(pointer: coarse)').matches) return

  element.focus()
}
