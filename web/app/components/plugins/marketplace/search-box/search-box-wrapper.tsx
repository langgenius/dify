'use client'

import { useTranslation } from '#i18n'
import { useMarketplaceSearchQuery, useMarketplaceTags } from '@/hooks/use-query-params'
import SearchBox from './index'

const SearchBoxWrapper = () => {
  const { t } = useTranslation()
  const [searchPluginText, handleSearchPluginTextChange] = useMarketplaceSearchQuery()
  const [filterPluginTags, handleFilterPluginTagsChange] = useMarketplaceTags()

  return (
    <SearchBox
      wrapperClassName="z-[11] mx-auto w-[640px] shrink-0"
      inputClassName="w-full"
      search={searchPluginText}
      onSearchChange={handleSearchPluginTextChange}
      tags={filterPluginTags}
      onTagsChange={handleFilterPluginTagsChange}
      placeholder={t('searchPlugins', { ns: 'plugin' })}
      usedInMarketplace
    />
  )
}

export default SearchBoxWrapper
