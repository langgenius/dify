export type HomeCatalogTabSlot = 'content' | 'header'

const getCatalogTabSlot = (slot: HomeCatalogTabSlot) =>
  document.querySelector<HTMLElement>(`[data-home-catalog-tabs-slot="${slot}"]`)

export const getFocusedCatalogTabHref = (slot: HomeCatalogTabSlot) => {
  const slotElement = getCatalogTabSlot(slot)
  const activeElement = document.activeElement
  if (!slotElement || !activeElement || !slotElement.contains(activeElement)) return null

  return activeElement.closest<HTMLAnchorElement>('a[href]')?.getAttribute('href') ?? null
}

export const focusCatalogTab = (slot: HomeCatalogTabSlot, href: string) => {
  const slotElement = getCatalogTabSlot(slot)
  const matchingLink = Array.from(slotElement?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])
    .find(link => link.getAttribute('href') === href)

  matchingLink?.focus({ preventScroll: true })
}
