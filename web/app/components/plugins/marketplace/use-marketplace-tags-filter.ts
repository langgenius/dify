import { markMarketplaceSiteFilter } from '@/utils/marketplace-site-track'
import { useFilterPluginTags } from './atoms'

export function useMarketplaceTagsFilter() {
  const [tags, setTags] = useFilterPluginTags()
  const onTagsChange = (nextTags: string[]) => {
    const addedTag = nextTags.find((tag) => !tags.includes(tag))
    const removedTag = tags.find((tag) => !nextTags.includes(tag))
    markMarketplaceSiteFilter({
      filter_type: 'category',
      selection_mode: 'multi',
      filter_value: addedTag ?? removedTag ?? nextTags.at(-1) ?? '',
      selected_values: nextTags,
    })
    void setTags(nextTags.length ? nextTags : null)
  }

  return { tags, onTagsChange }
}
