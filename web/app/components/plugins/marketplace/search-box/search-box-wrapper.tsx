'use client'

import { useMarketplaceContext } from '../context'
import { useMixedTranslation } from '../hooks'
import SearchBox from './index'

type SearchBoxWrapperProps = {
  locale?: string
}
const SearchBoxWrapper = ({
  locale,
}: SearchBoxWrapperProps) => {
  const { t } = useMixedTranslation(locale)
  const searchPluginText = useMarketplaceContext(v => v.searchPluginText)
  const handleSearchPluginTextChange = useMarketplaceContext(v => v.handleSearchPluginTextChange)
  const filterPluginTags = useMarketplaceContext(v => v.filterPluginTags)
  const handleFilterPluginTagsChange = useMarketplaceContext(v => v.handleFilterPluginTagsChange)

  return (
    <SearchBox
      wrapperClassName='z-[11] mx-auto w-[640px] shrink-0'
      inputClassName='w-full'
      search={searchPluginText}
      onSearchChange={handleSearchPluginTextChange}
      tags={filterPluginTags}
      onTagsChange={handleFilterPluginTagsChange}
      locale={locale}
      placeholder={t('plugin.searchPlugins')}
      usedInMarketplace
    />
  )
}

export default SearchBoxWrapper
