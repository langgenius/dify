'use client'

import type { AppListUrlQuery } from '@/app/components/apps/query-params'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
import { AppSortFilter } from '@/app/components/apps/app-sort-filter'
import { AppTypeFilter } from '@/app/components/apps/app-type-filter'

type Props = {
  view: 'all' | 'starred'
  category: AppListUrlQuery['category']
  sortBy: AppListUrlQuery['sort_by']
  onViewChange: (view: Props['view']) => void
  onCategoryChange: (category: Props['category']) => void
  onSortChange: (sortBy: Props['sortBy']) => void
}

export default function PublishedAppsToolbar({
  view,
  category,
  sortBy,
  onViewChange,
  onCategoryChange,
  onSortChange,
}: Props) {
  const { t } = useTranslation(['app', 'navigation'])

  return (
    <div className="flex flex-wrap items-center gap-2 px-8 pb-1">
      <SegmentedControl<Props['view']>
        value={view}
        onValueChange={onViewChange}
        aria-label={t(($) => $['mainNav.publishedApps'], { ns: 'navigation' })}
      >
        <SegmentedControlItem value="all">
          {t(($) => $['endUser.all'], { ns: 'app' })}
        </SegmentedControlItem>
        <SegmentedControlItem value="starred">
          {t(($) => $['endUser.starred'], { ns: 'app' })}
        </SegmentedControlItem>
      </SegmentedControl>
      <AppTypeFilter value={category} onValueChange={onCategoryChange} />
      <AppSortFilter value={sortBy} onChange={onSortChange} />
    </div>
  )
}
