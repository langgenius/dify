'use client'

import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

type AppListQuery = NonNullable<GetAppsData['query']>
type AppListSortBy = NonNullable<AppListQuery['sort_by']>

type AppSortFilterProps = {
  value: AppListSortBy
  onChange: (value: AppListSortBy) => void
}

export function AppSortFilter({ value, onChange }: AppSortFilterProps) {
  const { t } = useTranslation(['app'])
  const sortLabelId = useId()

  const options = [
    { value: 'last_modified', label: t(($) => $['studio.sort.lastModified'], { ns: 'app' }) },
    {
      value: 'recently_created',
      label: t(($) => $['studio.sort.recentlyCreated'], { ns: 'app' }),
    },
    {
      value: 'earliest_created',
      label: t(($) => $['studio.sort.earliestCreated'], { ns: 'app' }),
    },
  ] satisfies Array<{ value: AppListSortBy; label: string }>

  const sortByLabel = t(($) => $['studio.sort.sortBy'], { ns: 'app' })

  return (
    <Select<AppListSortBy>
      items={options}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onChange(nextValue)
      }}
    >
      <SelectTrigger aria-labelledby={sortLabelId} className="w-auto">
        <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
          {/* aria-labelledby names the control; exclude this prefix from its accessible value. */}
          <span
            id={sortLabelId}
            aria-hidden="true"
            className="shrink-0 font-normal text-text-tertiary"
          >
            {sortByLabel}
          </span>{' '}
          <SelectValue className="min-w-0 truncate font-medium text-text-secondary" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem<AppListSortBy> key={option.value} value={option.value}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
