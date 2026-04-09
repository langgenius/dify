'use client'

import type { EvaluationResourceProps } from '../../types'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Input from '@/app/components/base/input'
import { cn } from '@/utils/classnames'
import { useEvaluationResource } from '../../store'

const PipelineHistoryTable = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const [query, setQuery] = useState('')
  const statusLabels = {
    running: t('batch.status.running'),
    success: t('batch.status.success'),
    failed: t('batch.status.failed'),
  }

  const filteredRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword)
      return resource.batchRecords

    return resource.batchRecords.filter(record =>
      record.fileName.toLowerCase().includes(keyword)
      || record.summary.toLowerCase().includes(keyword),
    )
  }, [query, resource.batchRecords])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-2">
        <div className="system-xl-semibold text-text-primary">{t('history.title')}</div>
        <div className="w-[160px] shrink-0 sm:w-[200px]">
          <Input
            value={query}
            showLeftIcon
            placeholder={t('history.searchPlaceholder')}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-effects-highlight bg-background-default">
          <div className="grid grid-cols-[minmax(0,1.8fr)_80px_80px_80px_40px] rounded-t-lg bg-background-section px-2 py-1">
            <div className="flex items-center gap-1 px-2 system-xs-medium-uppercase text-text-tertiary">
              <span>{t('history.columns.time')}</span>
              <span aria-hidden="true" className="i-ri-arrow-down-line h-3 w-3" />
            </div>
            <div className="px-2 system-xs-medium-uppercase text-text-tertiary">{t('history.columns.creator')}</div>
            <div className="px-2 system-xs-medium-uppercase text-text-tertiary">{t('history.columns.version')}</div>
            <div className="px-2 text-center system-xs-medium-uppercase text-text-tertiary">{t('history.columns.status')}</div>
            <div />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredRecords.length > 0 && (
              <div className="divide-y divide-divider-subtle">
                {filteredRecords.map(record => (
                  <div
                    key={record.id}
                    className="grid grid-cols-[minmax(0,1.8fr)_80px_80px_80px_40px] items-center px-2 py-2"
                  >
                    <div className="truncate px-2 system-sm-regular text-text-secondary">{record.startedAt}</div>
                    <div className="truncate px-2 system-sm-regular text-text-secondary">{t('history.creatorYou')}</div>
                    <div className="truncate px-2 system-sm-regular text-text-secondary">{t('history.latestVersion')}</div>
                    <div className="flex justify-center px-2">
                      <Badge
                        className={cn(
                          record.status === 'failed' && 'badge-warning',
                          record.status === 'success' && 'badge-accent',
                        )}
                      >
                        {record.status === 'running'
                          ? (
                              <span className="flex items-center gap-1">
                                <span aria-hidden="true" className="i-ri-loader-4-line h-3 w-3 animate-spin" />
                                {statusLabels.running}
                              </span>
                            )
                          : statusLabels[record.status]}
                      </Badge>
                    </div>
                    <div className="flex justify-center">
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-text-quaternary hover:bg-state-base-hover"
                        aria-label={record.summary}
                      >
                        <span aria-hidden="true" className="i-ri-more-2-line h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {filteredRecords.length === 0 && (
              <div className="flex h-full min-h-[321px] flex-col items-center justify-center gap-2 px-4 text-center">
                <span aria-hidden="true" className="i-ri-history-line h-5 w-5 text-text-quaternary" />
                <div className="system-sm-medium text-text-quaternary">{t('history.empty')}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PipelineHistoryTable
