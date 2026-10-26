import type { KnowledgeUpgrade } from './knowledge-upgrade-context-value'

type KnowledgeUpgradeFilters = {
  creatorIds: string[]
  query: string
  tagIds: string[]
}

export function matchesKnowledgeUpgradeFilters(
  { dataset }: KnowledgeUpgrade,
  { creatorIds, query, tagIds }: KnowledgeUpgradeFilters,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (
    normalizedQuery &&
    ![dataset.name, dataset.description]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery))
  ) {
    return false
  }

  if (creatorIds.length > 0 && (!dataset.maintainer || !creatorIds.includes(dataset.maintainer)))
    return false

  if (tagIds.length > 0 && !dataset.tags.some((tag) => tagIds.includes(tag.id))) return false

  return true
}
