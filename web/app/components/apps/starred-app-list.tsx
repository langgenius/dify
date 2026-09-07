'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { useTranslation } from 'react-i18next'
import { APP_LIST_GRID_CLASS_NAME } from './constants'
import { StarredAppCard } from './starred-app-card'

type StarredAppListProps = {
  apps: AppPartial[]
  stepByStepTourCardTarget?: string
  stepByStepTourCardHighlightPart?: string
  stepByStepTourHighlightedCardCount?: number
}

const STARRED_APPS_HEADING_ID = 'starred-apps-heading'
export const ALL_APPS_HEADING_ID = 'all-apps-heading'

export function AppListSectionHeading({ id, label }: { id: string; label: string }) {
  return (
    <div className="flex h-7 flex-col items-start px-8 pt-3">
      <div className="flex h-4 w-full items-center">
        <h2 id={id} className="system-xs-medium-uppercase text-text-tertiary uppercase">
          {label}
        </h2>
      </div>
    </div>
  )
}

export function StarredAppList({
  apps,
  stepByStepTourCardTarget,
  stepByStepTourCardHighlightPart,
  stepByStepTourHighlightedCardCount = 0,
}: StarredAppListProps) {
  const { t } = useTranslation()

  if (apps.length === 0) return null

  return (
    <>
      <AppListSectionHeading
        id={STARRED_APPS_HEADING_ID}
        label={t(($) => $['studio.starred'], { ns: 'app' })}
      />
      <ul
        // Safari list semantics: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/list-style#accessibility
        // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Dify's preflight removes list markers.
        role="list"
        aria-labelledby={STARRED_APPS_HEADING_ID}
        className={APP_LIST_GRID_CLASS_NAME}
      >
        {apps.map((app, index) => (
          <StarredAppCard
            key={app.id}
            app={app}
            stepByStepTourCardTarget={index === 0 ? stepByStepTourCardTarget : undefined}
            stepByStepTourCardHighlightPart={
              index < stepByStepTourHighlightedCardCount
                ? stepByStepTourCardHighlightPart
                : undefined
            }
          />
        ))}
      </ul>
    </>
  )
}
