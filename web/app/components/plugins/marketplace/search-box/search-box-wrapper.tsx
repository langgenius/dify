'use client'

import { useTranslation } from '#i18n'
import { useMarketplaceContext } from '../context'
import SearchBox from './index'

const SearchBoxWrapper = () => {
  const { t } = useTranslation()
  const searchPluginText = useMarketplaceContext(v => v.searchPluginText)
  const handleSearchPluginTextChange = useMarketplaceContext(v => v.handleSearchPluginTextChange)
  const filterPluginTags = useMarketplaceContext(v => v.filterPluginTags)
  const handleFilterPluginTagsChange = useMarketplaceContext(v => v.handleFilterPluginTagsChange)

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
