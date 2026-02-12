'use client'

import type { UnifiedSearchParams } from '../types'
import { useTranslation } from '#i18n'
import { useDebounce } from 'ahooks'
import { useSetAtom } from 'jotai'
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
  searchModeAtom,
  useSearchText,
} from '../atoms'
import { useMarketplaceUnifiedSearch } from '../query'
import { mapUnifiedCreatorToCreator, mapUnifiedPluginToPlugin, mapUnifiedTemplateToTemplate } from '../utils'
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
  const [searchText, handleSearchTextChange] = useSearchText()
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

  const handleSubmit = () => {
    const trimmed = draftSearch.trim()
    if (!trimmed)
      return
    router.push(`/search/all/?q=${encodeURIComponent(trimmed)}`)
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
          <Input
            wrapperClassName={cn('w-[200px] rounded-lg lg:w-[300px]', wrapperClassName)}
            className={cn('h-9 bg-components-input-bg-normal', inputClassName)}
            showLeftIcon
            value={inputValue}
            placeholder={t('searchInMarketplace', { ns: 'plugin' })}
            onChange={(e) => {
              setDraftSearch(e.target.value)
            }}
            onFocus={() => {
              setDraftSearch(committedSearch)
              setIsFocused(true)
            }}
            onBlur={() => {
              if (!isHoveringDropdown) {
                if (!draftSearch.trim()) {
                  handleSearchTextChange('')
                  setSearchMode(null)
                }
                setIsFocused(false)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                handleSubmit()
            }}
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
          templates={dropdownTemplates}
          creators={dropdownCreators}
          onShowAll={handleSubmit}
          isLoading={dropdownQuery.isLoading}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SearchBoxWrapper
