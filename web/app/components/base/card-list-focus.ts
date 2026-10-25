// Capture the source section before deletion can unmount its card or the whole list.
export function getAdjacentCardFocusTargets(source: HTMLElement | null): HTMLElement[] {
  const card = source?.closest('li')
  if (!card?.parentElement) return []

  const cards = Array.from(card.parentElement.children)
  const index = cards.indexOf(card)
  return [...cards.slice(index + 1), ...cards.slice(0, index).reverse()].flatMap((sibling) => {
    const target = sibling.querySelector<HTMLElement>(':scope > a[href], :scope > button')
    return target ? [target] : []
  })
}
