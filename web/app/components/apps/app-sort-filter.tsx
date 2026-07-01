'use client'

import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type AppListQuery = NonNullable<GetAppsData['query']>
type AppListSortBy = NonNullable<AppListQuery['sort_by']>

type AppSortFilterProps = {
  value: AppListSortBy
  onChange: (value: AppListSortBy) => void
}

const appListSortByValues: AppListSortBy[] = ['last_modified', 'recently_created', 'earliest_created']

function isAppListSortBy(value: string): value is AppListSortBy {
  return appListSortByValues.includes(value as AppListSortBy)
}

export function AppSortFilter({
  value,
  onChange,
}: AppSortFilterProps) {
  const { t } = useTranslation()

  const options = useMemo(() => ([
    { value: 'last_modified', text: t('studio.sort.lastModified', { ns: 'app' }) },
    { value: 'recently_created', text: t('studio.sort.recentlyCreated', { ns: 'app' }) },
    { value: 'earliest_created', text: t('studio.sort.earliestCreated', { ns: 'app' }) },
  ] satisfies Array<{ value: AppListSortBy, text: string }>), [t])

  const activeOption = options.find(option => option.value === value) ?? options[0]!
  const sortByLabel = t('studio.sort.sortBy', { ns: 'app' })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${sortByLabel} ${activeOption.text}`}
        className="flex h-8 cursor-pointer items-center rounded-lg border-none bg-components-input-bg-normal py-1 pr-2.5 pl-2 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover"
      >
        <span className="flex items-center gap-1 p-1 text-[13px] leading-4 whitespace-nowrap">
          <span className="font-normal text-text-tertiary">{sortByLabel}</span>
          <span className="font-medium text-text-secondary">{activeOption.text}</span>
        </span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" sideOffset={4} popupClassName="w-[220px]">
        <DropdownMenuRadioGroup value={value} onValueChange={nextValue => isAppListSortBy(nextValue) && onChange(nextValue)}>
          {options.map(option => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              <span className="min-w-0 flex-1 truncate">{option.text}</span>
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
