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

  const resetCreators = useCallback(() => {
    onChange([])
    setKeywords('')
  }, [onChange])

  const resetCreatorsFromTrigger = useCallback(() => {
    triggerRef.current?.focus()
    resetCreators()
  }, [resetCreators])

  const resetCreatorsFromPopover = useCallback(() => {
    searchInputRef.current?.focus()
    resetCreators()
  }, [resetCreators])

  const selectedCount = value.length
  const selectedAvatarCreators = selectedCreators.slice(0, 3)
  const isSelected = selectedCount > 0
  const creatorFilterLabel = t(($) => $['studio.filters.creators'], { ns: 'app' })
  const selectedCountLabel = isSelected
    ? t(($) => $['dynamicSelect.selected'], {
        ns: 'common',
        count: selectedCount,
      })
    : ''

  return (
    <div className="relative inline-flex items-stretch">
      <Combobox<CreatorOption, true>
        multiple
        items={creatorOptions}
        value={selectedCreatorValues}
        inputValue={keywords}
        isItemEqualToValue={(creator, selectedCreator) => creator.id === selectedCreator.id}
        itemToStringLabel={(creator) => creator.name}
        itemToStringValue={(creator) => creator.id}
        onInputValueChange={setKeywords}
        onValueChange={handleValueChange}
      >
        <ComboboxTrigger
          ref={triggerRef}
          icon={false}
          aria-label={creatorFilterLabel}
          className={cn(
            baseChipClassName,
            'w-auto',
            isSelected
              ? 'rounded-r-none border-r-0 border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-state-base-hover'
              : 'border-transparent bg-components-input-bg-normal text-text-tertiary hover:bg-components-input-bg-hover',
          )}
        >
          <ComboboxValue<CreatorOption, true>>
            <span aria-hidden className="flex min-w-0 items-center">
              <span className="px-1 text-text-tertiary">{creatorFilterLabel}</span>
              {isSelected ? (
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
                  <span className="text-xs leading-4 font-medium text-text-tertiary">{`+${selectedCount}`}</span>
                </>
              ) : (
                <span className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary" />
              )}
            </span>
            <span className="sr-only">{selectedCountLabel}</span>
          </ComboboxValue>
        </ComboboxTrigger>
        <ComboboxPortal>
          <ComboboxPositioner placement="bottom-start" sideOffset={4}>
            <ComboboxPopup
              aria-label={t(($) => $['studio.filters.creators'], { ns: 'app' })}
              className="w-[min(280px,var(--available-width))] min-w-[min(var(--anchor-width),var(--available-width))] bg-components-panel-bg-blur text-sm text-text-secondary backdrop-blur-[5px]"
            >
              <div className="flex items-center gap-1 p-2 pb-1">
                <ComboboxInputGroup className="relative h-8 min-h-8 grow">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder"
                  />
                  <ComboboxInput
                    ref={searchInputRef}
                    type="search"
                    name="creator-query"
                    enterKeyHint="search"
                    aria-label={t(($) => $['studio.filters.searchCreators'], { ns: 'app' })}
                    className={cn(
                      'h-full py-0 pl-6.5 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
                      keywords && 'pr-8',
                    )}
                    placeholder={t(($) => $['studio.filters.searchCreators'], { ns: 'app' })}
                  />
                  {!!keywords && (
                    <button
                      type="button"
                      aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
                      className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-components-input-text-placeholder outline-hidden hover:text-components-input-text-filled focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                      onClick={() => {
                        setKeywords('')
                        searchInputRef.current?.focus()
                      }}
                    >
                      <span aria-hidden className="i-ri-close-circle-fill size-4" />
                    </button>
                  )}
                </ComboboxInputGroup>
                {isSelected && (
                  <button
                    type="button"
                    className="shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    onClick={resetCreatorsFromPopover}
                  >
                    {t(($) => $['studio.filters.reset'], { ns: 'app' })}
                  </button>
                )}
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
                      <ComboboxItemIndicator className="ms-0 size-3" />
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
                        <span className="truncate text-sm text-text-secondary">{creator.name}</span>
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
      {isSelected && (
        <button
          type="button"
          aria-label={t(($) => $['studio.filters.reset'], { ns: 'app' })}
          className="flex h-8 w-6 shrink-0 items-center justify-center rounded-r-lg border-[0.5px] border-l-0 border-components-button-secondary-border bg-components-button-secondary-bg text-text-quaternary shadow-xs outline-hidden hover:bg-state-base-hover hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={resetCreatorsFromTrigger}
        >
          <span aria-hidden className="i-ri-close-circle-fill h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export default CreatorsFilter
