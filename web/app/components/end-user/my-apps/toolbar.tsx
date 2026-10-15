'use client'

import type { Ref } from 'react'
import type { AppListFilter } from './model'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'

type Props = {
  filter: AppListFilter
  searchInputRef: Ref<HTMLInputElement>
  onFilterChange: (filter: Partial<AppListFilter>) => void
}

export default function MyAppsToolbar({ filter, searchInputRef, onFilterChange }: Props) {
  const { t } = useTranslation(['app', 'common'])
  const sortLabels = {
    'last-used': t(($) => $['endUser.lastUsed'], { ns: 'app' }),
    name: t(($) => $['endUser.name'], { ns: 'app' }),
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SegmentedControl<AppListFilter['view']>
        value={filter.view}
        onValueChange={(view) => onFilterChange({ view })}
        aria-label={t(($) => $['endUser.myApps'], { ns: 'app' })}
      >
        <SegmentedControlItem value="all">
          {t(($) => $['endUser.all'], { ns: 'app' })}
        </SegmentedControlItem>
        <SegmentedControlItem value="starred">
          {t(($) => $['endUser.starred'], { ns: 'app' })}
        </SegmentedControlItem>
      </SegmentedControl>
      <div className="flex min-w-0 items-center gap-2 max-sm:w-full">
        <Select<AppListFilter['sort']>
          value={filter.sort}
          onValueChange={(sort) => sort && onFilterChange({ sort })}
        >
          <SelectTrigger
            className="w-auto"
            aria-label={t(($) => $['endUser.sortBy'], { ns: 'app' })}
          >
            <span className="text-text-tertiary">
              {t(($) => $['endUser.sortBy'], { ns: 'app' })}
            </span>{' '}
            {sortLabels[filter.sort]}
          </SelectTrigger>
          <SelectContent>
            {(['last-used', 'name'] as const).map((sort) => (
              <SelectItem key={sort} value={sort}>
                <SelectItemText>{sortLabels[sort]}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchInput
          ref={searchInputRef}
          className="w-50 max-w-full max-sm:min-w-0 max-sm:flex-1"
          value={filter.q}
          onValueChange={(q) => onFilterChange({ q })}
          placeholder={t(($) => $['operation.search'], { ns: 'common' })}
          aria-label={t(($) => $['endUser.searchApps'], { ns: 'app' })}
        />
      </div>
    </div>
  )
}
