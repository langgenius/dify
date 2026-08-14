'use client'

import type {
  CreatorCreation,
  CreatorCreationAction,
  CreatorSortField,
  CreatorSortOrder,
} from './model'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import CreationCard from './creation-card'
import { sortCreatorCreations } from './model'

type CreatorContentProps = {
  creations: CreatorCreation[]
  getCreationAction: (creation: CreatorCreation) => CreatorCreationAction
}

export default function CreatorContent({ creations, getCreationAction }: CreatorContentProps) {
  const { t } = useTranslation()
  const [sortField, setSortField] = useState<CreatorSortField>('updatedAt')
  const [sortOrder, setSortOrder] = useState<CreatorSortOrder>('desc')
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
    () => sortCreatorCreations(creations, sortField, sortOrder),
    [creations, sortField, sortOrder],
  )
  const nextSortOrder = sortOrder === 'desc' ? 'asc' : 'desc'

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
              popupClassName="min-w-[176px] p-1"
            >
              <DropdownMenuRadioGroup<CreatorSortField>
                value={sortField}
                onValueChange={setSortField}
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
            onClick={() => setSortOrder(nextSortOrder)}
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
    </section>
  )
}
