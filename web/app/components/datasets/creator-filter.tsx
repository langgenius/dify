'use client'

import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
  ComboboxTrigger,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useId, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { getAvatarInitial } from '@/utils/avatar'
import { CREATOR_FILTER_MAX_SELECTION } from './creator-filter-query'

type CreatorFilterProps = {
  value: string[]
  onChange: (value: string[]) => void
}

export function CreatorFilter({ value, onChange }: CreatorFilterProps) {
  const { t } = useTranslation(['dataset'])
  const { t: tApp } = useTranslation(['app'])
  const { t: tCommon } = useTranslation(['common'])
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const { data, isError, isPending, refetch } = useQuery(
    consoleQuery.workspaces.current.members.get.queryOptions({ input: {} }),
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectionLimitId = useId()
  const label = t(($) => $['creatorFilter.creators'])
  const triggerLabel = value.length > 0 ? `${label}: ${value.length}` : label
  const hasInitialError = isError && data === undefined
  const hasRefetchError = isError && data !== undefined
  const selectionAtLimit = value.length >= CREATOR_FILTER_MAX_SELECTION

  const creators = useMemo(() => {
    return [...(data?.accounts ?? [])]
      .filter((member) => member.status !== 'pending')
      .sort((left, right) => {
        if (left.id === currentUserId) return -1
        if (right.id === currentUserId) return 1
        return left.name.localeCompare(right.name)
      })
  }, [currentUserId, data?.accounts])
  const creatorItems = useMemo(
    () =>
      createComboboxItems(creators, {
        getValue: (creator) => creator.id,
        getLabel: (creator) => creator.name,
      }),
    [creators],
  )
  const selectedCreators = useMemo(() => {
    const creatorsById = new Map(creators.map((creator) => [creator.id, creator]))
    return value.flatMap((creatorId) => {
      const creator = creatorsById.get(creatorId)
      return creator ? [creator] : []
    })
  }, [creators, value])

  const clearSelection = () => {
    onChange([])
    // The clear button unmounts with the selection, so keep focus on the filter it belongs to.
    triggerRef.current?.focus()
  }

  return (
    <Combobox<string, true, AccountWithRoleResponse>
      multiple
      autoHighlight
      items={creatorItems}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue.length <= CREATOR_FILTER_MAX_SELECTION) onChange(nextValue)
      }}
    >
      <div className="relative inline-flex h-8 items-stretch">
        <ComboboxTrigger
          ref={triggerRef}
          aria-label={triggerLabel}
          className={cn(
            'flex items-center rounded-lg border-[0.5px] px-2 whitespace-nowrap transition-colors motion-reduce:transition-none',
            value.length > 0
              ? 'border-components-button-secondary-border bg-components-button-secondary-bg pr-7 shadow-xs hover:bg-state-base-hover data-popup-open:bg-state-base-hover'
              : 'border-transparent bg-components-input-bg-normal text-text-tertiary hover:bg-components-input-bg-hover',
          )}
        >
          <span className="px-1 system-sm-regular text-text-tertiary">{label}</span>
          {selectedCreators.slice(0, 3).map((creator, index) => (
            <Avatar
              key={creator.id}
              size="xs"
              aria-hidden="true"
              className={cn('border border-components-panel-bg', index > 0 && '-ml-1')}
            >
              <AvatarFallback>{getAvatarInitial(creator.name)}</AvatarFallback>
              <AvatarImage src={creator.avatar_url || undefined} alt="" />
            </Avatar>
          ))}
          {value.length > 0 ? (
            <span className="px-1 text-xs font-medium text-text-tertiary">+{value.length}</span>
          ) : (
            <span aria-hidden className="i-ri-arrow-down-s-line size-4 text-text-tertiary" />
          )}
        </ComboboxTrigger>
        {value.length > 0 && (
          <IconButton
            size="sm"
            aria-label={tApp(($) => $['studio.filters.reset'])}
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={clearSelection}
          >
            <span aria-hidden className="i-ri-close-circle-fill size-3.5" />
          </IconButton>
        )}
      </div>
      <ComboboxPortal>
        <ComboboxPositioner placement="bottom-start" sideOffset={4}>
          <ComboboxPopup
            aria-label={label}
            className="w-[min(17.5rem,var(--available-width))] min-w-[min(var(--anchor-width),var(--available-width))]"
          >
            <ComboboxInputGroup>
              <span
                aria-hidden
                className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
              />
              <ComboboxInput
                name="creator-query"
                enterKeyHint="search"
                aria-label={tApp(($) => $['studio.filters.searchCreators'])}
                placeholder={tApp(($) => $['studio.filters.searchCreators'])}
                disabled={isPending || hasInitialError}
              />
            </ComboboxInputGroup>
            {hasRefetchError && (
              <div
                role="alert"
                className="mx-2 mt-1 flex items-center justify-between gap-2 rounded-md bg-state-destructive-hover px-2 py-1 system-sm-regular text-text-tertiary"
              >
                <span>{tCommon(($) => $.error)}</span>
                <Button size="small" variant="ghost" onClick={() => void refetch()}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            )}
            {selectionAtLimit && (
              <div
                id={selectionLimitId}
                role="status"
                className="px-3 pt-2 system-xs-regular text-text-destructive"
              >
                {t(($) => $['creatorFilter.maxCreators'])}: {CREATOR_FILTER_MAX_SELECTION}
              </div>
            )}
            {isPending ? (
              <ComboboxStatus className="flex h-20 items-center justify-center gap-2">
                <span
                  aria-hidden
                  className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
                />
                {tCommon(($) => $.loading)}
              </ComboboxStatus>
            ) : hasInitialError ? (
              <div
                role="alert"
                className="flex h-20 flex-col items-center justify-center gap-1 px-3 text-center"
              >
                <span className="system-sm-regular text-text-tertiary">
                  {tCommon(($) => $.error)}
                </span>
                <Button size="small" variant="ghost" onClick={() => void refetch()}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            ) : (
              <>
                <ComboboxEmpty>
                  {tCommon(($) => $['operation.noSearchResults'], { content: label })}
                </ComboboxEmpty>
                <ComboboxList<AccountWithRoleResponse> className="max-h-60">
                  {(creator) => {
                    const selectionDisabled = selectionAtLimit && !value.includes(creator.id)
                    return (
                      <ComboboxItem<string>
                        key={creator.id}
                        value={creator.id}
                        disabled={selectionDisabled}
                        aria-describedby={selectionDisabled ? selectionLimitId : undefined}
                      >
                        <ComboboxItemText className="flex items-center gap-2 font-normal">
                          <Avatar
                            size="xs"
                            aria-hidden="true"
                            className="border-[0.5px] border-divider-regular"
                          >
                            <AvatarFallback>{getAvatarInitial(creator.name)}</AvatarFallback>
                            <AvatarImage src={creator.avatar_url || undefined} alt="" />
                          </Avatar>
                          <span className="min-w-0 flex-1 truncate system-sm-regular">
                            {creator.name}
                          </span>
                          {creator.id === currentUserId && (
                            <span className="shrink-0 system-sm-regular text-text-quaternary">
                              {tApp(($) => $['studio.filters.you'])}
                            </span>
                          )}
                        </ComboboxItemText>
                        <ComboboxItemIndicator />
                      </ComboboxItem>
                    )
                  }}
                </ComboboxList>
              </>
            )}
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  )
}
