'use client'

import type { Emoji, EmojiGroup } from './emoji-data'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteRow,
  AutocompleteStatus,
} from '@langgenius/dify-ui/autocomplete'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { memo, useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { emojiCatalogOptions } from './emoji-data'
import { recommendedEmojis } from './emoji-styles'
import { useRecentEmojisValue } from './recent-emojis'

export type EmojiPickerProps = {
  value?: string
  onValueChange: (emoji: string) => void
  className?: string
}

const columns = 9
const emptyGroups: EmojiGroup[] = []
const itemToString = (item: Emoji) => item.label

type IndexedGroup = EmojiGroup & { startIndex: number }

const EmojiList = memo(
  ({
    groups,
    value,
    onValueChange,
    label,
  }: {
    groups: IndexedGroup[]
    value?: string
    onValueChange: (emoji: string) => void
    label: string
  }) => {
    return (
      <AutocompleteList aria-label={label} className="max-h-none min-h-0 flex-1 scroll-py-8 p-0">
        {groups.map((group) => (
          <AutocompleteGroup key={group.id} items={group.items} className="mb-2 first:mt-2">
            <AutocompleteGroupLabel className="sticky top-0 z-1 mb-0.5 bg-components-panel-bg px-3.5 py-1 system-xs-medium-uppercase text-text-tertiary">
              {group.label}
            </AutocompleteGroupLabel>
            {Array.from({ length: Math.ceil(group.items.length / columns) }, (_, row) => (
              <AutocompleteRow key={row} className="grid grid-cols-9 gap-px px-3 pb-px">
                {group.items.slice(row * columns, (row + 1) * columns).map((item, column) => (
                  <AutocompleteItem
                    key={item.emoji}
                    index={group.startIndex + row * columns + column}
                    value={item}
                    aria-label={item.label}
                    onClick={() => onValueChange(item.emoji)}
                    className={cn(
                      value === item.emoji &&
                        'ring-[1.5px] ring-components-option-card-option-selected-border ring-inset',
                      'm-0 flex size-8 min-h-0 items-center justify-center rounded-lg p-0 text-2xl leading-none data-highlighted:bg-state-base-hover',
                    )}
                  >
                    <span aria-hidden="true">{item.emoji}</span>
                  </AutocompleteItem>
                ))}
              </AutocompleteRow>
            ))}
          </AutocompleteGroup>
        ))}
      </AutocompleteList>
    )
  },
)

/** Search is transient; choosing a candidate changes the caller's value, never the query. */
export function EmojiPicker({ value, onValueChange, className }: EmojiPickerProps) {
  const { t } = useTranslation(['app', 'common'])
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const recent = useRecentEmojisValue()
  const catalog = useQuery(emojiCatalogOptions)
  const categories = catalog.data ?? emptyGroups
  const groups = useMemo(() => {
    const byEmoji = new Map(
      categories.flatMap((group) => group.items.map((item) => [item.emoji, item] as const)),
    )
    const toItems = (values: string[]) =>
      values.flatMap((emoji) => {
        const item = byEmoji.get(emoji)
        return item ? [{ ...item }] : []
      })
    return [
      {
        id: 'recent',
        label: t(($) => $['iconPicker.recent'], { ns: 'app' }),
        items: toItems(recent),
      },
      {
        id: 'recommended',
        label: t(($) => $['iconPicker.recommend'], { ns: 'app' }),
        items: toItems(recommendedEmojis),
      },
      ...categories,
    ].filter((group) => group.items.length)
  }, [categories, recent, t])
  const searchIndex = useMemo(
    () =>
      new Map(
        categories.flatMap((group) =>
          group.items.map(
            (item) =>
              [
                item.emoji,
                `${item.emoji} ${item.label} ${item.tags?.join(' ') ?? ''}`.toLocaleLowerCase('en'),
              ] as const,
          ),
        ),
      ),
    [categories],
  )
  const filteredGroups = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase('en')
    const filtered = query
      ? categories
          .map((group) => ({
            ...group,
            items: group.items.filter((item) => searchIndex.get(item.emoji)?.includes(query)),
          }))
          .filter((group) => group.items.length)
      : groups
    let startIndex = 0
    return filtered.map((group) => {
      const result = { ...group, startIndex }
      startIndex += group.items.length
      return result
    })
  }, [categories, deferredSearch, groups, searchIndex])

  return (
    <Autocomplete
      inline
      open
      grid
      autoHighlight
      items={groups}
      value={search}
      onValueChange={(next, details) => {
        if (details.reason !== 'item-press') setSearch(next)
      }}
      filteredItems={filteredGroups}
      filter={null}
      itemToStringValue={itemToString}
    >
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <div className="shrink-0 border-b border-divider-subtle px-3 pb-2">
          <AutocompleteInputGroup>
            <span
              className="ms-2 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
              aria-hidden="true"
            />
            <AutocompleteInput
              data-icon-picker-initial-focus
              aria-label={t(($) => $['iconPicker.search'], { ns: 'app' })}
              placeholder={t(($) => $['iconPicker.search'], { ns: 'app' })}
              className="ps-1.5"
            />
            <AutocompleteClear aria-label={t(($) => $['iconPicker.clearSearch'], { ns: 'app' })} />
          </AutocompleteInputGroup>
        </div>
        <output className="sr-only">
          {value
            ? t(($) => $['iconPicker.currentEmoji'], {
                ns: 'app',
                emoji:
                  categories.flatMap((group) => group.items).find((item) => item.emoji === value)
                    ?.label ?? value,
              })
            : null}
        </output>
        <AutocompleteStatus className="sr-only">
          {catalog.isPending
            ? t(($) => $.loading, { ns: 'common' })
            : catalog.isError
              ? t(($) => $.error, { ns: 'common' })
              : null}
        </AutocompleteStatus>
        {catalog.isError && (
          <div className="p-3">
            <p>{t(($) => $.error, { ns: 'common' })}</p>
            <Button onClick={() => void catalog.refetch()}>
              {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
            </Button>
          </div>
        )}
        {catalog.isPending && (
          <div className="p-3 text-text-tertiary">{t(($) => $.loading, { ns: 'common' })}</div>
        )}
        {!catalog.isPending && !catalog.isError && (
          <AutocompleteEmpty className="p-3 text-text-tertiary">
            {t(($) => $.noData, { ns: 'common' })}
          </AutocompleteEmpty>
        )}
        <EmojiList
          groups={filteredGroups}
          value={value}
          onValueChange={onValueChange}
          label={t(($) => $['iconPicker.emoji'], { ns: 'app' })}
        />
      </div>
    </Autocomplete>
  )
}
