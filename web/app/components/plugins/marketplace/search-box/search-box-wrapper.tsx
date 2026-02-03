'use client'

import { useTranslation } from '#i18n'
import { cn } from '@/utils/classnames'
import { useFilterPluginTags, useSearchPluginText } from '../atoms'
import SearchBox from './index'

type SearchBoxWrapperProps = {
  wrapperClassName?: string
  inputClassName?: string
}
const SearchBoxWrapper = ({
  wrapperClassName,
  inputClassName,
}: SearchBoxWrapperProps) => {
  const { t } = useTranslation()
  const [searchPluginText, handleSearchPluginTextChange] = useSearchPluginText()
  const [filterPluginTags, handleFilterPluginTagsChange] = useFilterPluginTags()

  return (
    <SearchBox
      wrapperClassName={cn('z-[11] mx-auto w-[640px] shrink-0', wrapperClassName)}
      inputClassName={cn('w-full', inputClassName)}
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
