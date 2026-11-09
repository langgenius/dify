'use client'

import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { noop } from 'es-toolkit/function'
import { useTranslation } from 'react-i18next'
import { AppSortFilter } from '@/app/components/apps/app-sort-filter'
import { AppTypeFilter } from '@/app/components/apps/app-type-filter'

type Props = {
  view: 'all' | 'starred'
  onViewChange: (view: Props['view']) => void
}

export default function PublishedAppsToolbar({ view, onViewChange }: Props) {
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
      <AppTypeFilter value="all" onValueChange={noop} />
      <AppSortFilter value="last_modified" onChange={noop} />
    </div>
  )
}
