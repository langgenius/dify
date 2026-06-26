'use client'

import type { WorkflowRunArchiveMonthResponse } from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'

const numberFormatter = new Intl.NumberFormat()
const byteFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
})
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

function formatNumber(value: number) {
  return numberFormatter.format(value)
}

function formatBytes(bytes: number) {
  if (bytes <= 0)
    return '0 B'

  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${byteFormatter.format(value)} ${BYTE_UNITS[unitIndex]}`
}

function formatMonth(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function formatDate(value: string | null | undefined) {
  if (!value)
    return '-'
  return value.slice(0, 10)
}

const tableGridClassName = 'grid-cols-[0.62fr_0.8fr_0.65fr_0.8fr_0.75fr]'

export default function WorkflowLogArchivesPage() {
  const { t } = useTranslation()
  const archiveListQuery = useQuery(consoleQuery.workflowRunArchives.get.queryOptions())
  const createDownloadMutation = useMutation(consoleQuery.workflowRunArchives.downloads.post.mutationOptions())
  const [pendingArchiveKey, setPendingArchiveKey] = useState<string | null>(null)
  const archiveData = archiveListQuery.data
  const archiveMonths = archiveData?.months ?? []
  const summary = archiveData?.summary
  const isLoading = archiveListQuery.isLoading

  const handleDownload = (archive: WorkflowRunArchiveMonthResponse) => {
    if (createDownloadMutation.isPending)
      return

    const archiveKey = formatMonth(archive.year, archive.month)
    setPendingArchiveKey(archiveKey)
    createDownloadMutation.mutate({
      body: {
        year: archive.year,
        month: archive.month,
      },
    }, {
      onSuccess: () => {
        toast.success(t('archives.action.prepareStarted', { ns: 'appLog' }))
      },
      onError: () => {
        toast.error(t('archives.action.prepareFailed', { ns: 'appLog' }))
      },
      onSettled: () => {
        setPendingArchiveKey(null)
      },
    })
  }

  const summaryItems = [
    {
      label: t('archives.summary.months', { ns: 'appLog' }),
      value: summary ? formatNumber(summary.archived_month_count) : '0',
      icon: 'i-ri-calendar-2-line',
      accentClassName: 'bg-util-colors-blue-blue-500',
      iconClassName: 'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-600',
    },
    {
      label: t('archives.summary.runs', { ns: 'appLog' }),
      value: summary ? formatNumber(summary.workflow_run_count) : '0',
      icon: 'i-ri-git-branch-line',
      accentClassName: 'bg-util-colors-green-green-500',
      iconClassName: 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-600',
    },
    {
      label: t('archives.summary.size', { ns: 'appLog' }),
      value: summary ? formatBytes(summary.archive_bytes) : '0 B',
      icon: 'i-ri-hard-drive-2-line',
      accentClassName: 'bg-util-colors-warning-warning-500',
      iconClassName: 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-600',
    },
    {
      label: t('archives.summary.latest', { ns: 'appLog' }),
      value: formatDate(summary?.latest_archived_at),
      icon: 'i-ri-time-line',
      accentClassName: 'bg-util-colors-orange-orange-500',
      iconClassName: 'border-util-colors-orange-orange-200 bg-util-colors-orange-orange-50 text-util-colors-orange-orange-600',
    },
  ]

  return (
    <div data-testid="workflow-log-archives-page" className="flex flex-col gap-4 pb-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {summaryItems.map(item => (
          <div key={item.label} className="relative flex min-h-28 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs shadow-shadow-shadow-3">
            <div className={cn('absolute inset-x-0 top-0 h-1', item.accentClassName)} />
            <div className="flex items-start justify-between gap-3 pt-1">
              <div className="min-h-8 min-w-0 system-xs-medium-uppercase text-text-tertiary">{item.label}</div>
              <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl border-[0.5px] shadow-xs', item.iconClassName)}>
                <span className={cn(item.icon, 'size-5')} aria-hidden="true" />
              </div>
            </div>
            {isLoading
              ? (
                  <SkeletonRectangle className="mt-auto h-8 w-24 animate-pulse rounded-md" />
                )
              : (
                  <div className="mt-auto title-2xl-semi-bold whitespace-nowrap text-text-primary">{item.value}</div>
                )}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs">
        <div className="overflow-x-auto">
          <div className="min-w-[520px]">
            <div className={cn('grid h-8 items-center gap-3 border-b border-divider-subtle bg-background-section-burn px-4 system-xs-medium-uppercase text-text-tertiary', tableGridClassName)}>
              <div className="text-center">{t('archives.table.month', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.runs', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.files', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.size', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.action', { ns: 'appLog' })}</div>
            </div>
            {isLoading && (
              <>
                {['first', 'second', 'third'].map(key => (
                  <div
                    key={key}
                    className={cn('grid min-h-15 items-center gap-3 border-b border-divider-subtle px-4 py-3 last:border-b-0', tableGridClassName)}
                  >
                    <div className="flex justify-center"><SkeletonRectangle className="h-4 w-16 animate-pulse" /></div>
                    <div className="flex justify-center"><SkeletonRectangle className="h-4 w-16 animate-pulse" /></div>
                    <div className="flex justify-center"><SkeletonRectangle className="h-4 w-12 animate-pulse" /></div>
                    <div className="flex justify-center"><SkeletonRectangle className="h-4 w-14 animate-pulse" /></div>
                    <div className="flex justify-center"><SkeletonRectangle className="h-8 w-24 animate-pulse rounded-lg" /></div>
                  </div>
                ))}
              </>
            )}
            {!isLoading && archiveListQuery.isError && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="i-ri-error-warning-line size-6 text-text-tertiary" aria-hidden="true" />
                <div className="system-sm-semibold text-text-secondary">{t('archives.error.title', { ns: 'appLog' })}</div>
                <div className="system-xs-regular text-text-tertiary">{t('archives.error.description', { ns: 'appLog' })}</div>
              </div>
            )}
            {!isLoading && !archiveListQuery.isError && archiveMonths.length === 0 && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="i-ri-archive-line size-6 text-text-tertiary" aria-hidden="true" />
                <div className="system-sm-semibold text-text-secondary">{t('archives.empty.title', { ns: 'appLog' })}</div>
                <div className="system-xs-regular text-text-tertiary">{t('archives.empty.description', { ns: 'appLog' })}</div>
              </div>
            )}
            {!isLoading && !archiveListQuery.isError && archiveMonths.map((archive) => {
              const archiveMonth = formatMonth(archive.year, archive.month)
              const isDownloadPending = createDownloadMutation.isPending && pendingArchiveKey === archiveMonth

              return (
                <div
                  key={archiveMonth}
                  className={cn('grid min-h-15 items-center gap-3 border-b border-divider-subtle px-4 py-3 last:border-b-0', tableGridClassName)}
                >
                  <div className="min-w-0 text-center">
                    <span className="truncate system-sm-semibold text-text-primary">{archiveMonth}</span>
                  </div>
                  <div className="text-center system-sm-medium text-text-secondary tabular-nums">{formatNumber(archive.workflow_run_count)}</div>
                  <div className="text-center system-sm-medium text-text-secondary tabular-nums">
                    {t('archives.table.fileCount', { ns: 'appLog', count: archive.bundle_count })}
                  </div>
                  <div className="text-center system-sm-medium text-text-secondary tabular-nums">{formatBytes(archive.archive_bytes)}</div>
                  <div className="flex justify-center">
                    <Button
                      size="small"
                      variant="secondary"
                      loading={isDownloadPending}
                      disabled={createDownloadMutation.isPending}
                      className="gap-1 px-2"
                      aria-label={t('archives.action.downloadMonth', { ns: 'appLog', month: archiveMonth })}
                      onClick={() => handleDownload(archive)}
                    >
                      {!isDownloadPending && <span className="i-ri-download-2-line size-3.5" aria-hidden="true" />}
                      {isDownloadPending
                        ? t('archives.action.preparing', { ns: 'appLog' })
                        : t('operation.download', { ns: 'common' })}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
