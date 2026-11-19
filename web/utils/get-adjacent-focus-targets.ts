/** Capture candidates before the source item unmounts: following siblings, then preceding siblings in reverse. */
export function getAdjacentFocusTargets<T extends HTMLElement>(
  item: Element | null | undefined,
  getTarget: (sibling: Element) => T | null,
): T[] {
  if (!item?.parentElement) return []

  const siblings = Array.from(item.parentElement.children)
  const index = siblings.indexOf(item)
  const targets: T[] = []
  for (const sibling of [...siblings.slice(index + 1), ...siblings.slice(0, index).reverse()]) {
    const target = getTarget(sibling)
    if (target) targets.push(target)
  }
  return targets
}
