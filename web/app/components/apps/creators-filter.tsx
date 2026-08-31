'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
  ComboboxValue,
} from '@langgenius/dify-ui/combobox'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useMembers } from '@/service/use-common'

type CreatorsFilterProps = {
  value: string[]
  onChange: (value: string[]) => void
}

type CreatorOption = {
  id: string
  name: string
  avatarUrl: string | null
  isYou: boolean
}

const baseChipClassName =
  'flex h-8 items-center whitespace-nowrap rounded-lg border-[0.5px] px-2 text-[13px] leading-4 outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid'

const CreatorsFilter = ({ value, onChange }: CreatorsFilterProps) => {
  const { t } = useTranslation()
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const { data: membersData } = useMembers()
  const [keywords, setKeywords] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const creatorOptions = useMemo<CreatorOption[]>(() => {
    const members = membersData?.accounts ?? []

    return [...members]
      .filter((member) => member.status !== 'pending')
      .sort((left, right) => {
        if (left.id === currentUserId) return -1
        if (right.id === currentUserId) return 1
        return left.name.localeCompare(right.name)
      })
      .map((member) => ({
        id: member.id,
        name: member.name,
        avatarUrl: member.avatar_url,
        isYou: member.id === currentUserId,
      }))
  }, [currentUserId, membersData?.accounts])

  const creatorMap = useMemo(
    () => new Map(creatorOptions.map((creator) => [creator.id, creator])),
    [creatorOptions],
  )
  const selectedCreatorValues = useMemo(() => {
    return value.map(
      (id) =>
        creatorMap.get(id) ?? {
          id,
          name: id,
          avatarUrl: null,
          isYou: false,
        },
    )
  }, [creatorMap, value])
  const selectedCreators = useMemo(() => {
    return value
      .map((id) => creatorMap.get(id))
      .filter((creator): creator is CreatorOption => Boolean(creator))
  }, [creatorMap, value])

  const handleValueChange = useCallback(
    (creators: CreatorOption[]) => onChange(creators.map((creator) => creator.id)),
    [onChange],
  )

  const clearCreatorQuery = useCallback(() => {
    setKeywords('')
    searchInputRef.current?.focus()
  }, [])

  const handleSelectionClear = useCallback(() => {
    onChange([])
    setKeywords('')
    triggerRef.current?.focus()
  }, [onChange])

  const selectedCount = value.length
  const selectedAvatarCreators = selectedCreators.slice(0, 3)
  const creatorFilterLabel = t(($) => $['studio.filters.creators'], { ns: 'app' })
  const resetLabel = t(($) => $['studio.filters.reset'], { ns: 'app' })
  const selectedCountLabel =
    selectedCount > 0
      ? t(($) => $['dynamicSelect.selected'], {
          ns: 'common',
          count: selectedCount,
        })
      : ''

  return (
    <Combobox<CreatorOption, true>
      multiple
      autoHighlight
      items={creatorOptions}
      value={selectedCreatorValues}
      inputValue={keywords}
      isItemEqualToValue={(creator, selectedCreator) => creator.id === selectedCreator.id}
      itemToStringLabel={(creator) => creator.name}
      itemToStringValue={(creator) => creator.id}
      onInputValueChange={setKeywords}
      onValueChange={handleValueChange}
    >
      <div className="relative inline-flex h-8 items-stretch">
        <ComboboxTrigger
          ref={triggerRef}
          icon={false}
          aria-label={creatorFilterLabel}
          className={cn(
            baseChipClassName,
            'peer/creators-trigger w-auto min-w-0 border-components-button-secondary-border bg-components-button-secondary-bg pr-8 shadow-xs hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-placeholder:border-transparent data-placeholder:bg-components-input-bg-normal data-placeholder:pr-2 data-placeholder:text-text-tertiary data-placeholder:shadow-none data-placeholder:hover:bg-components-input-bg-hover data-popup-open:bg-state-base-hover-alt',
          )}
        >
          <ComboboxValue<CreatorOption, true>>
            <span aria-hidden className="flex min-w-0 items-center">
              <span className="px-1 text-text-tertiary group-data-popup-open/combobox-trigger:text-text-secondary">
                {creatorFilterLabel}
              </span>
              {selectedCount > 0 ? (
                <>
                  <span className="flex items-center pr-1">
                    {selectedAvatarCreators.map((creator, index) => (
                      <Avatar
                        key={creator.id}
                        avatar={creator.avatarUrl}
                        name={creator.name}
                        size="xs"
                        className={cn('border border-components-panel-bg', index > 0 && '-ml-1')}
                      />
                    ))}
                  </span>
                  <span className="text-xs leading-4 font-medium text-text-tertiary group-data-popup-open/combobox-trigger:text-text-secondary">{`+${selectedCount}`}</span>
                </>
              ) : (
                <span className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary group-data-popup-open/combobox-trigger:text-text-secondary" />
              )}
            </span>
            <span className="sr-only">{selectedCountLabel}</span>
          </ComboboxValue>
        </ComboboxTrigger>
        {selectedCount > 0 && (
          <IconButton
            size="sm"
            aria-label={resetLabel}
            className="absolute top-1/2 right-1 size-5 -translate-y-1/2 text-text-tertiary peer-data-popup-open/creators-trigger:text-text-secondary"
            onClick={handleSelectionClear}
          >
            <span aria-hidden className="i-ri-close-circle-fill h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
      <ComboboxPortal>
        <ComboboxPositioner placement="bottom-start" sideOffset={4}>
          <ComboboxPopup
            aria-label={t(($) => $['studio.filters.creators'], { ns: 'app' })}
            className="w-[min(280px,var(--available-width))] min-w-[min(var(--anchor-width),var(--available-width))] bg-components-panel-bg-blur text-sm text-text-secondary backdrop-blur-[5px]"
          >
            <div className="p-2 pb-1">
              <ComboboxInputGroup className="h-8 min-h-8 px-2">
                <ComboboxInput
                  ref={searchInputRef}
                  type="search"
                  name="creator-query"
                  enterKeyHint="search"
                  aria-label={t(($) => $['studio.filters.searchCreators'], { ns: 'app' })}
                  className="block h-4.5 grow px-1 py-0 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                  placeholder={t(($) => $['studio.filters.searchCreators'], { ns: 'app' })}
                />
                <span
                  aria-hidden
                  className="order-first me-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
                />
                {!!keywords && (
                  <IconButton
                    size="sm"
                    aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
                    className="me-0 shrink-0 text-text-quaternary hover:bg-transparent hover:text-text-tertiary focus-visible:bg-components-input-bg-hover focus-visible:ring-inset"
                    onClick={clearCreatorQuery}
                  >
                    <span aria-hidden className="i-ri-close-circle-fill size-4" />
                  </IconButton>
                )}
              </ComboboxInputGroup>
            </div>
            <ComboboxList<CreatorOption> className="max-h-60 px-1 pt-0 pb-1">
              {(creator) => (
                <ComboboxItem
                  key={creator.id}
                  value={creator}
                  className="group/creator-option grid-cols-[auto_1fr] gap-1 rounded-md"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-components-checkbox-border bg-components-checkbox-bg-unchecked text-components-checkbox-icon shadow-xs shadow-shadow-shadow-3 group-data-selected/creator-option:border-transparent group-data-selected/creator-option:bg-components-checkbox-bg"
                  >
                    <ComboboxItemIndicator className="ms-0 size-3 text-components-checkbox-icon" />
                  </span>
                  <ComboboxItemText className="flex items-center gap-2 px-1 font-normal">
                    <span aria-hidden>
                      <Avatar
                        avatar={creator.avatarUrl}
                        name={creator.name}
                        size="xs"
                        className="border-[0.5px] border-divider-regular"
                      />
                    </span>
                    <span className="flex min-w-0 grow items-center justify-between gap-2">
                      <span className="truncate text-sm text-text-secondary" title={creator.name}>
                        {creator.name}
                      </span>
                      {creator.isYou && (
                        <span className="shrink-0 text-sm text-text-quaternary">
                          {t(($) => $['studio.filters.you'], { ns: 'app' })}
                        </span>
                      )}
                    </span>
                  </ComboboxItemText>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  )
}

export default CreatorsFilter
