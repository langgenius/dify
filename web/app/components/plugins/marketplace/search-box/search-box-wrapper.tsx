'use client'

import { useTranslation } from '#i18n'
import { useFilterPluginTags, useSearchPluginText } from '../atoms'
import SearchBox from './index'

const SearchBoxWrapper = () => {
  const { t } = useTranslation()
  const [searchPluginText, handleSearchPluginTextChange] = useSearchPluginText()
  const [filterPluginTags, handleFilterPluginTagsChange] = useFilterPluginTags()

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
