'use client'

import type { DatasetGraphStatsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type StatsBarProps = {
  stats?: DatasetGraphStatsResponse
}

/**
 * Headline counts plus the entity-type breakdown.
 *
 * The breakdown is a labelled list rather than a pie: there are up to ten types,
 * the reader wants to look up one exact count, and a chart would encode nothing
 * the numbers do not already say.
 */
const StatsBar = ({ stats }: StatsBarProps) => {
  const { t } = useTranslation()

  const sortedTypes = useMemo(() => {
    if (!stats?.entity_types) return []
    return Object.entries(stats.entity_types).sort(([, a], [, b]) => b - a)
  }, [stats?.entity_types])

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-4 py-3">
      <div className="flex flex-col">
        <div className="system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['graph.entities'], { ns: 'datasetSettings' })}
        </div>
        <div className="system-xl-semibold text-text-primary">{stats?.entity_count ?? 0}</div>
      </div>
      <div className="flex flex-col">
        <div className="system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['graph.relations'], { ns: 'datasetSettings' })}
        </div>
        <div className="system-xl-semibold text-text-primary">{stats?.relation_count ?? 0}</div>
      </div>
      {sortedTypes.length > 0 && (
        <div className="flex min-w-0 flex-col gap-y-1">
          <div className="system-xs-medium-uppercase text-text-tertiary">
            {t(($) => $['graph.entityTypes'], { ns: 'datasetSettings' })}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {sortedTypes.map(([entityType, count]) => (
              <span
                key={entityType}
                className="flex items-center gap-x-1 rounded-md bg-components-badge-bg-dimm px-1.5 py-0.5 system-xs-regular text-text-secondary"
              >
                <span className="truncate">{entityType}</span>
                <span className="text-text-tertiary">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(StatsBar)
