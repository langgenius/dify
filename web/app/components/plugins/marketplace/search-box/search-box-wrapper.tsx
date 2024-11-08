'use client'
import { useMarketplaceContext } from '../context'
import { useMixedTranslation } from '../hooks'
import SearchBox from './index'
import cn from '@/utils/classnames'

type SearchBoxWrapperProps = {
  locale?: string
}
const SearchBoxWrapper = ({
  locale,
}: SearchBoxWrapperProps) => {
  const { t } = useMixedTranslation(locale)
  const intersected = useMarketplaceContext(v => v.intersected)
  const searchPluginText = useMarketplaceContext(v => v.searchPluginText)
  const handleSearchPluginTextChange = useMarketplaceContext(v => v.handleSearchPluginTextChange)
  const filterPluginTags = useMarketplaceContext(v => v.filterPluginTags)
  const handleFilterPluginTagsChange = useMarketplaceContext(v => v.handleFilterPluginTagsChange)

  return (
    <SearchBox
      inputClassName={cn(
        'sticky top-3 mx-auto w-[640px] shrink-0',
        !intersected && 'w-[508px] transition-[width] duration-300',
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
