'use client'

import type { ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import type { OverviewStats } from './overview-drift'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { formatDate, releaseLabel } from '../../release'
import { openDeployDrawerAtom } from '../../store'

type PreviousReleasesProps = {
  appInstanceId: string
  releaseRows: ReleaseRow[]
  stats: OverviewStats
}

const PREVIOUS_RELEASES_LIMIT = 5

export function PreviousReleases({ appInstanceId, releaseRows, stats }: PreviousReleasesProps) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)

  const previous = releaseRows.slice(1, 1 + PREVIOUS_RELEASES_LIMIT).filter(row => row.id)

  if (previous.length === 0)
    return null

  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="system-sm-semibold text-text-primary">
          {t('overview.previousReleases.title')}
        </h3>
        <Link
          href={`/deployments/${appInstanceId}/releases`}
          className="inline-flex shrink-0 items-center gap-1 system-xs-medium text-text-tertiary transition-colors hover:text-text-secondary"
        >
          {t('overview.previousReleases.viewAll')}
          <span aria-hidden className="i-ri-arrow-right-line size-3.5" />
        </Link>
      </div>

      <ul className="divide-y divide-divider-subtle rounded-xl border border-components-panel-border bg-components-panel-bg">
        {previous.map((row) => {
          const author = row.createdBy?.name ?? ''
          const ago = row.createdAt ? formatTimeFromNow(new Date(row.createdAt).getTime()) : ''
          const deployedCount = row.deployedTo?.length ?? 0
          const propagation = stats.total === 0
            ? t('overview.hero.untargeted')
            : deployedCount === 0
              ? t('overview.previousReleases.retired')
              : t('overview.hero.propagation', { count: deployedCount, total: stats.total })

          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => openDeployDrawer({ appInstanceId, releaseId: row.id })}
                className="group flex w-full min-w-0 items-center gap-4 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-state-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-button-primary-bg"
              >
                <span className="min-w-0 shrink-0 truncate font-mono system-sm-semibold text-text-primary">
                  {releaseLabel(row)}
                </span>
                <span
                  className="min-w-0 grow truncate system-xs-regular text-text-tertiary"
                  title={row.createdAt ? formatDate(row.createdAt) : undefined}
                >
                  {[author && t('overview.hero.byName', { name: author }), ago].filter(Boolean).join(' · ')}
                </span>
                <span className="shrink-0 system-xs-regular text-text-tertiary">
                  {propagation}
                </span>
                <span
                  aria-hidden
                  className="i-ri-arrow-right-line size-4 shrink-0 text-text-quaternary transition-colors group-hover:text-text-tertiary"
                />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
