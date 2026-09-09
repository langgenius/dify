'use client'

import type { MarketplacePlugin, MarketplaceTemplate } from '@dify/contracts/marketplace'
import type {
  CreatorCreation,
  CreatorCreationAction,
  CreatorInventory,
  CreatorSortField,
  CreatorSortOrder,
} from './model'
import type { Plugin } from '@/app/components/plugins/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { parseAsStringEnum, useQueryStates } from 'nuqs'
import { useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import CreationCard from './creation-card'
import {
  CREATOR_SORT_FIELDS,
  DEFAULT_CREATOR_SORT_FIELD,
  DEFAULT_CREATOR_SORT_ORDER,
  sortCreatorCreations,
} from './model'
import { fetchPublisherPluginPage, fetchPublisherTemplatePage, toCreatorRecords } from './publisher'

type CreatorContentProps = {
  creations: CreatorCreation[]
  getCreationAction: (creation: CreatorCreation) => CreatorCreationAction
  inventory?: CreatorInventory
  locale?: string
  onRecordsLoaded?: (records: {
    pluginsByCreationId: Record<string, Plugin>
    templatesByCreationId: Record<string, MarketplaceTemplate>
  }) => void
}

const sortSearchOptions = { history: 'replace' as const, shallow: false, scroll: false }
const creatorSortSearchParsers = {
  sort_by: parseAsStringEnum<CreatorSortField>([...CREATOR_SORT_FIELDS]).withDefault(
    DEFAULT_CREATOR_SORT_FIELD,
  ),
  sort_order: parseAsStringEnum<CreatorSortOrder>(['asc', 'desc']).withDefault(
    DEFAULT_CREATOR_SORT_ORDER,
  ),
}

export default function CreatorContent({
  creations,
  getCreationAction,
  inventory,
  locale = 'en-US',
  onRecordsLoaded,
}: CreatorContentProps) {
  const { t } = useTranslation()
  const [sort, setSort] = useQueryStates(creatorSortSearchParsers, sortSearchOptions)
  const sortField = sort.sort_by
  const sortOrder = sort.sort_order
  const [sourceCreations, setSourceCreations] = useState(creations)
  const [loadedCreations, setLoadedCreations] = useState(creations)
  const [pluginHasMore, setPluginHasMore] = useState(inventory?.pluginHasMore ?? false)
  const [templateHasMore, setTemplateHasMore] = useState(inventory?.templateHasMore ?? false)
  const [pluginNextPage, setPluginNextPage] = useState(inventory?.pluginNextPage ?? 2)
  const [templateNextPage, setTemplateNextPage] = useState(inventory?.templateNextPage ?? 2)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  if (creations !== sourceCreations) {
    setSourceCreations(creations)
    setLoadedCreations(creations)
    setPluginHasMore(inventory?.pluginHasMore ?? false)
    setTemplateHasMore(inventory?.templateHasMore ?? false)
    setPluginNextPage(inventory?.pluginNextPage ?? 2)
    setTemplateNextPage(inventory?.templateNextPage ?? 2)
    setLoadMoreFailed(false)
  }
  const sortOptions: Array<{ value: CreatorSortField; label: string }> = [
    {
      value: 'updatedAt',
      label: t(($) => $['marketplace.creatorProfile.sort.updatedAt'], { ns: 'plugin' }),
    },
    {
      value: 'createdAt',
      label: t(($) => $['marketplace.creatorProfile.sort.createdAt'], { ns: 'plugin' }),
    },
    {
      value: 'popularity',
      label: t(($) => $['marketplace.creatorProfile.sort.popularity'], { ns: 'plugin' }),
    },
  ]
  const selectedSort = sortOptions.find((option) => option.value === sortField) ?? sortOptions[0]!
  const sortedCreations = useMemo(
    () => sortCreatorCreations(loadedCreations, sortField, sortOrder),
    [loadedCreations, sortField, sortOrder],
  )
  const nextSortOrder = sortOrder === 'desc' ? 'asc' : 'desc'
  const hasMore = pluginHasMore || templateHasMore
  const uniqueHandle = inventory?.uniqueHandle

  const loadMore = async () => {
    if (!uniqueHandle || isLoadingMore || !hasMore) return

    setIsLoadingMore(true)
    setLoadMoreFailed(false)
    try {
      const [pluginPage, templatePage] = await Promise.all([
        pluginHasMore
          ? fetchPublisherPluginPage({
              uniqueHandle,
              page: pluginNextPage,
              sortField,
              sortOrder,
            })
          : Promise.resolve({ items: [] as MarketplacePlugin[], hasMore: false }),
        templateHasMore
          ? fetchPublisherTemplatePage({
              uniqueHandle,
              page: templateNextPage,
              sortField,
              sortOrder,
            })
          : Promise.resolve({ items: [] as MarketplaceTemplate[], hasMore: false }),
      ])
      const records = toCreatorRecords({
        locale,
        plugins: pluginPage.items,
        templates: templatePage.items,
      })
      setLoadedCreations((current) => {
        const seen = new Set(current.map((creation) => creation.id))
        return [...current, ...records.creations.filter((creation) => !seen.has(creation.id))]
      })
      if (pluginHasMore) {
        setPluginHasMore(pluginPage.hasMore)
        setPluginNextPage((page) => page + 1)
      }
      if (templateHasMore) {
        setTemplateHasMore(templatePage.hasMore)
        setTemplateNextPage((page) => page + 1)
      }
      onRecordsLoaded?.(records)
    } catch {
      setLoadMoreFailed(true)
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <section
      aria-labelledby="creator-creations-title"
      className="flex min-w-0 flex-1 flex-col items-start pt-6"
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <h2 id="creator-creations-title" className="system-xl-semibold text-text-primary">
          {t(($) => $['marketplace.creatorProfile.creations'], { ns: 'plugin' })}
        </h2>

        <div className="flex h-8 items-center">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${t(($) => $['marketplace.creatorProfile.sortBy'], { ns: 'plugin' })} ${selectedSort.label}`}
              className="flex h-8 items-center rounded-lg px-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              <span className="mr-1 system-sm-regular text-text-tertiary">
                {t(($) => $['marketplace.creatorProfile.sortBy'], { ns: 'plugin' })}
              </span>
              <span className="system-sm-medium text-text-secondary">{selectedSort.label}</span>
              <span aria-hidden className="ml-1 i-ri-arrow-down-s-line size-4 text-text-tertiary" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              placement="bottom-end"
              sideOffset={4}
              className="min-w-[176px] p-1"
            >
              <DropdownMenuRadioGroup<CreatorSortField>
                value={sortField}
                onValueChange={(nextField) => {
                  void setSort({ sort_by: nextField, sort_order: sortOrder })
                }}
              >
                {sortOptions.map((option) => (
                  <DropdownMenuRadioItem<CreatorSortField>
                    key={option.value}
                    value={option.value}
                    closeOnClick
                    className="justify-between px-3 pr-2 system-md-regular text-text-primary"
                  >
                    {option.label}
                    <DropdownMenuRadioItemIndicator className="ml-2" />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="mx-1 h-4 w-px bg-divider-regular" />
          <button
            type="button"
            aria-label={t(($) => $[`marketplace.creatorProfile.sort.${nextSortOrder}`], {
              ns: 'plugin',
            })}
            title={t(($) => $[`marketplace.creatorProfile.sort.${nextSortOrder}`], {
              ns: 'plugin',
            })}
            className="flex size-8 items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => {
              void setSort({ sort_by: sortField, sort_order: nextSortOrder })
            }}
          >
            <span
              aria-hidden
              className={sortOrder === 'desc' ? 'i-ri-sort-desc size-4' : 'i-ri-sort-asc size-4'}
            />
          </button>
        </div>
      </div>

      {sortedCreations.length > 0 ? (
        <div className="grid w-full grid-cols-1 gap-3 pt-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedCreations.map((creation) => (
            <CreationCard
              key={creation.id}
              creation={creation}
              action={getCreationAction(creation)}
            />
          ))}
        </div>
      ) : (
        <div className="w-full py-12 text-center system-sm-regular text-text-tertiary">
          {t(($) => $['marketplace.creatorProfile.empty'], { ns: 'plugin' })}
        </div>
      )}

      {hasMore && (
        <div className="flex w-full flex-col items-center gap-2 pt-6">
          <button
            type="button"
            aria-busy={isLoadingMore || undefined}
            disabled={isLoadingMore}
            className="flex h-8 items-center rounded-lg px-3 system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:opacity-50"
            onClick={() => {
              void loadMore()
            }}
          >
            {t(($) => $['marketplace.creatorProfile.loadMore'], { ns: 'plugin' })}
          </button>
          {loadMoreFailed && (
            <p className="system-xs-regular text-text-destructive">
              {t(($) => $['marketplace.creatorProfile.loadMoreFailed'], { ns: 'plugin' })}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
