'use client'

import type { PluginsSearchParams } from '../types'
import { useTranslation } from '#i18n'
import { useDebounce } from 'ahooks'
import { useSetAtom } from 'jotai'
import { useMemo, useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import {
  searchModeAtom,
  useActivePluginType,
  useFilterPluginTags,
  useMarketplaceSortValue,
  useSearchPluginText,
} from '../atoms'
import { PLUGIN_TYPE_SEARCH_MAP } from '../constants'
import { useMarketplacePlugins } from '../query'
import { getMarketplaceListFilterType } from '../utils'
import SearchBox from './index'
import SearchDropdown from './search-dropdown'

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
  const [activePluginType] = useActivePluginType()
  const sort = useMarketplaceSortValue()
  const setSearchMode = useSetAtom(searchModeAtom)
  const committedSearch = searchPluginText || ''
  const [draftSearch, setDraftSearch] = useState(committedSearch)
  const [isFocused, setIsFocused] = useState(false)
  const [isHoveringDropdown, setIsHoveringDropdown] = useState(false)
  const debouncedDraft = useDebounce(draftSearch, { wait: 300 })
  const hasDraft = !!debouncedDraft.trim()

  const dropdownQueryParams = useMemo(() => {
    if (!hasDraft)
      return undefined
    const filterType = getMarketplaceListFilterType(activePluginType) as PluginsSearchParams['type']
    return {
      query: debouncedDraft.trim(),
      category: activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginType,
      tags: filterPluginTags,
      sort_by: sort.sortBy,
      sort_order: sort.sortOrder,
      type: filterType,
      page_size: 3,
    }
  }, [activePluginType, debouncedDraft, filterPluginTags, hasDraft, sort.sortBy, sort.sortOrder])

  const dropdownQuery = useMarketplacePlugins(dropdownQueryParams)
  const dropdownPlugins = dropdownQuery.data?.pages[0]?.plugins || []

  const handleSubmit = () => {
    const trimmed = draftSearch.trim()
    if (!trimmed)
      return
    handleSearchPluginTextChange(trimmed)
    setSearchMode(true)
    setIsFocused(false)
  }

  const inputValue = isFocused ? draftSearch : committedSearch
  const isDropdownOpen = hasDraft && (isFocused || isHoveringDropdown)

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={8}
      open={isDropdownOpen}
      onOpenChange={setIsFocused}
    >
      <PortalToFollowElemTrigger asChild>
        <div>
          <SearchBox
            wrapperClassName={cn('z-[11] mx-auto w-[640px] shrink-0', wrapperClassName)}
            inputClassName={cn('w-full', inputClassName)}
            search={inputValue}
            onSearchChange={setDraftSearch}
            onSearchSubmit={handleSubmit}
            onSearchFocus={() => {
              setDraftSearch(committedSearch)
              setIsFocused(true)
            }}
            onSearchBlur={() => {
              if (!isHoveringDropdown)
                setIsFocused(false)
            }}
            tags={filterPluginTags}
            onTagsChange={handleFilterPluginTagsChange}
            placeholder={t('searchPlugins', { ns: 'plugin' })}
            usedInMarketplace
          />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent
        className="z-[1001]"
        onMouseEnter={() => setIsHoveringDropdown(true)}
        onMouseLeave={() => setIsHoveringDropdown(false)}
        onMouseDown={(event) => {
          event.preventDefault()
        }}
      >
        <SearchDropdown
          query={debouncedDraft.trim()}
          plugins={dropdownPlugins}
          onShowAll={handleSubmit}
          isLoading={dropdownQuery.isLoading}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SearchBoxWrapper
