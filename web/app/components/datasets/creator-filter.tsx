'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldItem, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/client'
import { CREATOR_FILTER_MAX_SELECTION } from './creator-filter-query'

type CreatorFilterProps = {
  value: string[]
  onChange: (value: string[]) => void
}

export function CreatorFilter({ value, onChange }: CreatorFilterProps) {
  const { t } = useTranslation('dataset')
  const { t: tApp } = useTranslation('app')
  const { t: tCommon } = useTranslation('common')
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const { data, isError, isPending, refetch } = useQuery(
    consoleQuery.workspaces.current.members.get.queryOptions(),
  )
  const [keywords, setKeywords] = useState('')
  const label = t(($) => $['creatorFilter.creators'])
  const triggerLabel = value.length > 0 ? `${label}: ${value.length}` : label
  const hasInitialError = isError && data === undefined
  const hasRefetchError = isError && data !== undefined
  const selectionAtLimit = value.length >= CREATOR_FILTER_MAX_SELECTION
  const selectionLimitId = useId()

  const creators = useMemo(() => {
    return [...(data?.accounts ?? [])]
      .filter((member) => member.status !== 'pending')
      .sort((left, right) => {
        if (left.id === currentUserId) return -1
        if (right.id === currentUserId) return 1
        return left.name.localeCompare(right.name)
      })
  }, [currentUserId, data?.accounts])

  const filteredCreators = useMemo(() => {
    const normalizedKeywords = keywords.trim().toLocaleLowerCase()
    if (!normalizedKeywords) return creators
    return creators.filter((creator) =>
      creator.name.toLocaleLowerCase().includes(normalizedKeywords),
    )
  }, [creators, keywords])

  const selectedCreators = useMemo(() => {
    const creatorsById = new Map(creators.map((creator) => [creator.id, creator]))
    return value.flatMap((creatorId) => {
      const creator = creatorsById.get(creatorId)
      return creator ? [creator] : []
    })
  }, [creators, value])

  const reset = () => {
    onChange([])
    setKeywords('')
  }

  const updateSelection = (nextValue: string[]) => {
    if (nextValue.length <= CREATOR_FILTER_MAX_SELECTION) onChange(nextValue)
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={triggerLabel}
            className={cn(
              'flex h-8 items-center rounded-lg border-[0.5px] px-2 whitespace-nowrap outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              value.length > 0
                ? 'border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-state-base-hover'
                : 'border-transparent bg-components-input-bg-normal text-text-tertiary hover:bg-components-input-bg-hover',
            )}
          />
        }
      >
        <span className="px-1 system-sm-regular text-text-tertiary">{label}</span>
        {selectedCreators.slice(0, 3).map((creator, index) => (
          <Avatar
            key={creator.id}
            avatar={creator.avatar_url}
            name={creator.name}
            size="xs"
            className={cn('border border-components-panel-bg', index > 0 && '-ml-1')}
          />
        ))}
        {value.length > 0 && (
          <span className="px-1 text-xs font-medium text-text-tertiary">+{value.length}</span>
        )}
        <span aria-hidden className="i-ri-arrow-down-s-line size-4 text-text-tertiary" />
      </PopoverTrigger>
      <PopoverContent placement="bottom-start" sideOffset={4} className="w-70 p-0">
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <div className="flex items-center gap-1 p-2 pb-1">
          <div className="relative min-w-0 grow">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder"
            />
            <Input
              aria-label={tApp(($) => $['studio.filters.searchCreators'])}
              autoComplete="off"
              value={keywords}
              className={cn('pl-6.5', keywords && 'pr-6.5')}
              disabled={isPending || hasInitialError}
              placeholder={tApp(($) => $['studio.filters.searchCreators'])}
              onChange={(event) => setKeywords(event.target.value)}
            />
            {keywords && (
              <button
                type="button"
                aria-label={tCommon(($) => $['operation.clear'])}
                className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center text-components-input-text-placeholder outline-hidden hover:text-components-input-text-filled focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => setKeywords('')}
              >
                <span aria-hidden className="i-ri-close-circle-fill size-4" />
              </button>
            )}
          </div>
          {value.length > 0 && (
            <button
              type="button"
              className="shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={reset}
            >
              {tApp(($) => $['studio.filters.reset'])}
            </button>
          )}
        </div>
        {hasRefetchError && (
          <div
            role="alert"
            className="mx-2 flex items-center justify-between gap-2 rounded-md bg-state-destructive-hover px-2 py-1 text-sm text-text-tertiary"
          >
            <span>{tCommon(($) => $.error)}</span>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 font-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={() => void refetch()}
            >
              {tCommon(($) => $['operation.retry'])}
            </button>
          </div>
        )}
        {selectionAtLimit && (
          <div
            id={selectionLimitId}
            role="status"
            className="px-3 py-2 text-xs text-text-destructive"
          >
            {t(($) => $['creatorFilter.maxCreators'])}: {CREATOR_FILTER_MAX_SELECTION}
          </div>
        )}
        <div className="max-h-60 overflow-y-auto px-1 pb-1">
          {isPending ? (
            <div
              role="status"
              aria-label={tCommon(($) => $.loading)}
              className="flex h-20 items-center justify-center gap-2 text-sm text-text-tertiary"
            >
              <span
                aria-hidden
                className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
              />
              {tCommon(($) => $.loading)}
            </div>
          ) : hasInitialError ? (
            <div
              role="alert"
              className="flex h-20 flex-col items-center justify-center gap-1 px-3 text-center"
            >
              <span className="text-sm text-text-tertiary">{tCommon(($) => $.error)}</span>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm font-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => void refetch()}
              >
                {tCommon(($) => $['operation.retry'])}
              </button>
            </div>
          ) : filteredCreators.length > 0 ? (
            <Field name="creatorIds">
              <Fieldset render={<CheckboxGroup value={value} onValueChange={updateSelection} />}>
                <FieldsetLegend className="sr-only">{label}</FieldsetLegend>
                {filteredCreators.map((creator) => {
                  const selectionDisabled = selectionAtLimit && !value.includes(creator.id)
                  return (
                    <FieldItem key={creator.id}>
                      <FieldLabel
                        className={cn(
                          'flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 font-normal outline-hidden hover:bg-state-base-hover has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid',
                          selectionDisabled && 'cursor-not-allowed text-text-disabled',
                        )}
                      >
                        <Checkbox
                          value={creator.id}
                          disabled={selectionDisabled}
                          aria-describedby={selectionDisabled ? selectionLimitId : undefined}
                        />
                        <Avatar
                          avatar={creator.avatar_url}
                          name={creator.name}
                          size="xs"
                          className="border-[0.5px] border-divider-regular"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                          {creator.name}
                        </span>
                        {creator.id === currentUserId && (
                          <span className="shrink-0 text-sm text-text-quaternary">
                            {tApp(($) => $['studio.filters.you'])}
                          </span>
                        )}
                      </FieldLabel>
                    </FieldItem>
                  )
                })}
              </Fieldset>
            </Field>
          ) : (
            <div className="px-3 py-6 text-center text-sm text-text-tertiary">
              {tCommon(($) => $['operation.noSearchResults'], { content: label })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
