'use client'

import type { UnifiedSearchParams } from '../types'
import { useTranslation } from '#i18n'
import { useDebounce } from 'ahooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import Input from '@/app/components/base/input'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import {
  isMarketplacePlatformAtom,
  searchModeAtom,
  useSearchTab,
  useSearchText,
} from '../atoms'
import { useMarketplaceUnifiedSearch } from '../query'
import { mapUnifiedCreatorToCreator, mapUnifiedPluginToPlugin, mapUnifiedTemplateToTemplate } from '../utils'
import SearchDropdown from './search-dropdown'

type SearchBoxWrapperProps = {
  wrapperClassName?: string
  inputClassName?: string
  includeSource?: boolean
}
const SearchBoxWrapper = ({
  wrapperClassName,
  inputClassName,
  includeSource = true,
}: SearchBoxWrapperProps) => {
  const isMarketplacePlatform = useAtomValue(isMarketplacePlatformAtom)
  const { t } = useTranslation()
  const [searchText, handleSearchTextChange] = useSearchText()
  const [, setSearchTab] = useSearchTab()
  const setSearchMode = useSetAtom(searchModeAtom)
  const committedSearch = searchText || ''
  const [draftSearch, setDraftSearch] = useState(committedSearch)
  const [isFocused, setIsFocused] = useState(false)
  const [isHoveringDropdown, setIsHoveringDropdown] = useState(false)
  const debouncedDraft = useDebounce(draftSearch, { wait: 300 })
  const hasDraft = !!debouncedDraft.trim()
  const router = useRouter()

  const dropdownQueryParams = useMemo((): UnifiedSearchParams | undefined => {
    if (!hasDraft)
      return undefined
    return {
      query: debouncedDraft.trim(),
      scope: ['plugins', 'templates', 'creators'],
      page_size: 5,
    }
  }, [debouncedDraft, hasDraft])

  const dropdownQuery = useMarketplaceUnifiedSearch(dropdownQueryParams)
  const dropdownPlugins = useMemo(
    () => (dropdownQuery.data?.plugins.items || []).map(mapUnifiedPluginToPlugin),
    [dropdownQuery.data?.plugins.items],
  )
  const dropdownTemplates = useMemo(
    () => (dropdownQuery.data?.templates.items || []).map(mapUnifiedTemplateToTemplate),
    [dropdownQuery.data?.templates.items],
  )
  const dropdownCreators = useMemo(
    () => (dropdownQuery.data?.creators.items || []).map(mapUnifiedCreatorToCreator),
    [dropdownQuery.data?.creators.items],
  )

  const handleSubmit = (queryOverride?: string) => {
    const trimmed = (queryOverride ?? draftSearch).trim()
    if (!trimmed)
      return

    if (isMarketplacePlatform) {
      router.push(`/search/all/?q=${encodeURIComponent(trimmed)}`)
    }
    else {
      handleSearchTextChange(trimmed)
      setSearchTab('all')
      setSearchMode(true)
    }
    setIsFocused(false)
  }

  const inputValue = isFocused ? draftSearch : committedSearch
  const isDropdownOpen = hasDraft && (isFocused || isHoveringDropdown)

  return (
    <SearchBox
      wrapperClassName="z-11 mx-auto w-[640px] shrink-0"
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
