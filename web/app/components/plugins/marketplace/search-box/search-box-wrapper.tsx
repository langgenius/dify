'use client'

import { useTranslation } from '#i18n'
import { useFilterPluginTags, useSearchPluginText } from '../atoms'
import SearchBox from './index'

type SearchBoxWrapperProps = {
  wrapperClassName?: string
  inputClassName?: string
  inputElementClassName?: string
  searchIconName?: string
  searchIconClassName?: string
  placeholder?: string
  showTags?: boolean
  usedInMarketplace?: boolean
}

const SearchBoxWrapper = ({
  wrapperClassName = 'z-11 mx-auto w-[640px] shrink-0',
  inputClassName = 'w-full',
  inputElementClassName,
  searchIconName,
  searchIconClassName,
  placeholder,
  showTags = true,
  usedInMarketplace = true,
}: SearchBoxWrapperProps) => {
  const { t } = useTranslation()
  const [searchPluginText, handleSearchPluginTextChange] = useSearchPluginText()
  const [filterPluginTags, handleFilterPluginTagsChange] = useFilterPluginTags()

  return (
    <SearchBox
      wrapperClassName={wrapperClassName}
      inputClassName={inputClassName}
      inputElementClassName={inputElementClassName}
      searchIconName={searchIconName}
      searchIconClassName={searchIconClassName}
      search={searchPluginText}
      onSearchChange={handleSearchPluginTextChange}
      tags={filterPluginTags}
      onTagsChange={handleFilterPluginTagsChange}
      placeholder={placeholder ?? t(($) => $.searchPlugins, { ns: 'plugin' })}
      showTags={showTags}
      usedInMarketplace={usedInMarketplace}
    />
  )
}

export default SearchBoxWrapper
