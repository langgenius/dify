export const getHoveredParallelId = (relatedTarget: EventTarget | null) => {
  const element = relatedTarget as Element | null
  if (element && 'closest' in element) {
    const closestParallel = element.closest('[data-parallel-id]')
    if (closestParallel)
      return closestParallel.getAttribute('data-parallel-id')
  }

  return null
}
