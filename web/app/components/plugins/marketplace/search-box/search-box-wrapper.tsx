'use client'

import { useMarketplaceContext } from '../context'
import {
  useMixedTranslation,
  useSearchBoxAutoAnimate,
} from '../hooks'
import SearchBox from './index'
import cn from '@/utils/classnames'

type SearchBoxWrapperProps = {
  locale?: string
  searchBoxAutoAnimate?: boolean
}
const SearchBoxWrapper = ({
  locale,
  searchBoxAutoAnimate,
}: SearchBoxWrapperProps) => {
  const { t } = useMixedTranslation(locale)
  const intersected = useMarketplaceContext(v => v.intersected)
  const searchPluginText = useMarketplaceContext(v => v.searchPluginText)
  const handleSearchPluginTextChange = useMarketplaceContext(v => v.handleSearchPluginTextChange)
  const filterPluginTags = useMarketplaceContext(v => v.filterPluginTags)
  const handleFilterPluginTagsChange = useMarketplaceContext(v => v.handleFilterPluginTagsChange)
  const { searchBoxCanAnimate } = useSearchBoxAutoAnimate(searchBoxAutoAnimate)

  return (
    <SearchBox
      inputClassName={cn(
        'mx-auto w-[640px] shrink-0 z-[0]',
        searchBoxCanAnimate && 'sticky top-3 z-[11]',
        !intersected && searchBoxCanAnimate && 'w-[508px] transition-[width] duration-300',
      )}
      search={searchPluginText}
      onSearchChange={handleSearchPluginTextChange}
      tags={filterPluginTags}
      onTagsChange={handleFilterPluginTagsChange}
      size='large'
      locale={locale}
      placeholder={t('plugin.searchPlugins')}
    />
  )
}

export default SearchBoxWrapper
