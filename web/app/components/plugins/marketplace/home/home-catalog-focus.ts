export type HomeCatalogTabSlot = 'content' | 'header'

const getCatalogTabSlot = (slot: HomeCatalogTabSlot) =>
  document.querySelector<HTMLElement>(`[data-home-catalog-tabs-slot="${slot}"]`)

export const getFocusedCatalogTabHref = (slot: HomeCatalogTabSlot) => {
  const slotElement = getCatalogTabSlot(slot)
  const activeElement = document.activeElement
  if (!slotElement || !activeElement || !slotElement.contains(activeElement)) return null

  return activeElement.closest<HTMLAnchorElement>('a[href]')?.getAttribute('href') ?? null
}

// Chromium blurs a focused link that a breakpoint hides with `display: none` and moves focus
// to the body before resize and media query listeners run. Returns the hidden link's href so
// the handoff can still restore focus in the other slot.
export const getHiddenCatalogTabHref = (slot: HomeCatalogTabSlot, event: FocusEvent) => {
  if (event.relatedTarget || !(event.target instanceof Element)) return null

  const link = event.target.closest<HTMLAnchorElement>('a[href]')
  if (!link || !getCatalogTabSlot(slot)?.contains(link) || link.getClientRects().length > 0)
    return null

  return link.getAttribute('href')
}

export const focusCatalogTab = (slot: HomeCatalogTabSlot, href: string) => {
  const slotElement = getCatalogTabSlot(slot)
  const matchingLink = Array.from(
    slotElement?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [],
  ).find((link) => link.getAttribute('href') === href)

  matchingLink?.focus({ preventScroll: true })
}
