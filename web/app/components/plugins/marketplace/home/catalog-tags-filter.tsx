'use client'

import { PluginTagsFilter } from '../../plugin-tags-filter'
import { useMarketplaceTagsFilter } from '../use-marketplace-tags-filter'

export default function CatalogTagsFilter() {
  const { tags, onTagsChange } = useMarketplaceTagsFilter()
  return <PluginTagsFilter value={tags} onValueChange={onTagsChange} variant="labeled" />
}
