'use client'

import { useFilterPluginTags } from '../atoms'
import TagsFilter from '../search-box/tags-filter'

export default function CatalogTagsFilter() {
  const [tags, setTags] = useFilterPluginTags()
  return (
    <TagsFilter
      tags={tags}
      onTagsChange={(next) => setTags(next.length ? next : null)}
      usedInMarketplace
    />
  )
}
