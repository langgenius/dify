'use client'

import type {
  WorkflowRunArchiveDownloadStatus,
  WorkflowRunArchiveDownloadTaskResponse,
  WorkflowRunArchiveMonthResponse,
} from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { Plan } from '@/app/components/billing/type'
import { API_PREFIX, IS_CLOUD_EDITION } from '@/config'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'

const numberFormatter = new Intl.NumberFormat()
const byteFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
})
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const DOWNLOAD_TASK_POLLING_INTERVAL = 3000
const ARCHIVE_MONTH_PAGE_SIZE = 20

function formatNumber(value: number) {
  return numberFormatter.format(value)
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B'

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
  if (!value) return '-'
  return value.slice(0, 10)
}

function isPreparingStatus(status: WorkflowRunArchiveDownloadStatus | undefined) {
  return status === 'pending' || status === 'processing'
}

function buildArchiveDownloadFileUrl(downloadId: string) {
  return `${API_PREFIX}/workflow-run-archives/downloads/${downloadId}/file`
}

const tableGridClassName = 'grid-cols-[0.66fr_0.78fr_0.78fr_1fr]'

export default function WorkflowLogArchivesPage() {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const [visibleArchiveMonthCount, setVisibleArchiveMonthCount] = useState(ARCHIVE_MONTH_PAGE_SIZE)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const canViewArchiveContent = IS_CLOUD_EDITION && enableBilling && plan.type !== Plan.sandbox
  const archiveListQuery = useQuery(
    consoleQuery.workflowRunArchives.get.queryOptions({
      enabled: canViewArchiveContent,
    }),
  )
  const archiveData = archiveListQuery.data
  const archiveMonths = archiveData?.months ?? []
  const visibleArchiveMonths = archiveMonths.slice(0, visibleArchiveMonthCount)
  const summary = archiveData?.summary
  const isLoading = archiveListQuery.isLoading
  const hasMoreArchives = visibleArchiveMonths.length < archiveMonths.length

  useEffect(() => {
    if (!hasMoreArchives) return

    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return

        setVisibleArchiveMonthCount((count) =>
          Math.min(count + ARCHIVE_MONTH_PAGE_SIZE, archiveMonths.length),
        )
      },
      { rootMargin: '120px' },
    )
    observer.observe(loadMoreElement)

    return () => observer.disconnect()
  }, [archiveMonths.length, hasMoreArchives, visibleArchiveMonthCount])

  const summaryItems = [
    {
      label: t('archives.summary.months', { ns: 'appLog' }),
      value: summary ? formatNumber(summary.archived_month_count) : '0',
      icon: 'i-ri-calendar-2-line',
    },
    {
      label: t('archives.summary.runs', { ns: 'appLog' }),
      value: summary ? formatNumber(summary.workflow_run_count) : '0',
      icon: 'i-ri-git-branch-line',
    },
    {
      label: t('archives.summary.size', { ns: 'appLog' }),
      value: summary ? formatBytes(summary.archive_bytes) : '0 B',
      icon: 'i-ri-hard-drive-2-line',
    },
    {
      label: t('archives.summary.latest', { ns: 'appLog' }),
      value: formatDate(summary?.latest_archived_at),
      icon: 'i-ri-time-line',
    },
  ]

  if (!canViewArchiveContent) {
    return (
      <div data-testid="workflow-log-archives-page" className="pb-6">
        <ArchivedLogsUpgradeBanner />
      </div>
    )
  }

  return (
    <div data-testid="workflow-log-archives-page" className="flex flex-col gap-4 pb-6">
      <div className="rounded-2xl border-[0.5px] border-effects-highlight-lightmode-off bg-background-section-burn p-2">
        <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="flex min-h-[92px] flex-col gap-2 rounded-xl bg-components-panel-bg p-4"
            >
              <span className={cn(item.icon, 'size-4 text-text-tertiary')} aria-hidden="true" />
              <div className="system-xs-medium text-text-tertiary">{item.label}</div>
              <div className="flex min-h-6 items-center">
                {isLoading ? (
                  <SkeletonRectangle className="h-5 w-20 animate-pulse rounded-md" />
                ) : (
                  <div className="system-md-semibold whitespace-nowrap text-text-primary">
                    {item.value}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs">
        <div className="overflow-x-auto">
          <div className="min-w-[460px]">
            <div
              className={cn(
                'grid h-8 items-center gap-3 border-b border-divider-subtle bg-background-section-burn px-4 system-xs-medium-uppercase text-text-tertiary',
                tableGridClassName,
              )}
            >
              <div className="text-center">{t('archives.table.month', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.runs', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.size', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.action', { ns: 'appLog' })}</div>
            </div>
            {isLoading && (
              <>
                {['first', 'second', 'third'].map((key) => (
                  <div
                    key={key}
                    className={cn(
                      'grid min-h-15 items-center gap-3 border-b border-divider-subtle px-4 py-3 last:border-b-0',
                      tableGridClassName,
                    )}
                  >
                    <div className="flex justify-center">
                      <SkeletonRectangle className="h-4 w-16 animate-pulse" />
                    </div>
                    <div className="flex justify-center">
                      <SkeletonRectangle className="h-4 w-16 animate-pulse" />
                    </div>
                    <div className="flex justify-center">
                      <SkeletonRectangle className="h-4 w-14 animate-pulse" />
                    </div>
                    <div className="flex justify-center">
                      <SkeletonRectangle className="h-8 w-24 animate-pulse rounded-lg" />
                    </div>
                  </div>
                ))}
              </>
            )}
            {!isLoading && archiveListQuery.isError && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center">
                <span
                  className="i-ri-error-warning-line size-6 text-text-tertiary"
                  aria-hidden="true"
                />
                <div className="system-sm-semibold text-text-secondary">
                  {t('archives.error.title', { ns: 'appLog' })}
                </div>
                <div className="system-xs-regular text-text-tertiary">
                  {t('archives.error.description', { ns: 'appLog' })}
                </div>
              </div>
            )}
            {!isLoading && !archiveListQuery.isError && archiveMonths.length === 0 && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="i-ri-archive-line size-6 text-text-tertiary" aria-hidden="true" />
                <div className="system-sm-semibold text-text-secondary">
                  {t('archives.empty.title', { ns: 'appLog' })}
                </div>
                <div className="system-xs-regular text-text-tertiary">
                  {t('archives.empty.description', { ns: 'appLog' })}
                </div>
              </div>
            )}
            {!isLoading &&
              !archiveListQuery.isError &&
              visibleArchiveMonths.map((archive) => {
                const archiveMonth = formatMonth(archive.year, archive.month)

                return <WorkflowArchiveMonthRow key={archiveMonth} archive={archive} />
              })}
            {!isLoading && !archiveListQuery.isError && hasMoreArchives && (
              <div
                ref={loadMoreRef}
                className="flex h-10 items-center justify-center border-t border-divider-subtle bg-components-card-bg"
                aria-hidden="true"
              >
                <SkeletonRectangle className="h-4 w-20 animate-pulse rounded-md" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ArchivedLogsUpgradeBanner() {
  const { t } = useTranslation()
  const { setShowPricingModal } = useModalContext()

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-linear-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2 p-4 pl-6 shadow-lg backdrop-blur-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1 text-text-primary-on-surface">
        <div className="title-xl-semi-bold">{t('archives.upgradeTip.title', { ns: 'appLog' })}</div>
        <div className="system-sm-regular">
          {t('archives.upgradeTip.description', { ns: 'appLog' })}
        </div>
      </div>
      <button
        type="button"
        className="flex h-10 w-[120px] shrink-0 cursor-pointer items-center justify-center rounded-3xl border-none bg-white p-0 system-md-semibold text-text-accent shadow-xs hover:opacity-95"
        onClick={() => setShowPricingModal()}
      >
        {t('upgradeBtn.encourageShort', { ns: 'billing' })}
      </button>
    </div>
  )
}

function WorkflowArchiveMonthRow({ archive }: { archive: WorkflowRunArchiveMonthResponse }) {
  const { t } = useTranslation()
  const [downloadTask, setDownloadTask] = useState<WorkflowRunArchiveDownloadTaskResponse | null>(
    null,
  )
  const archiveMonth = formatMonth(archive.year, archive.month)
  const cachedTask = downloadTask ?? archive.download_task ?? null
  const downloadTaskId = cachedTask?.download_id
  const taskQuery = useQuery(
    consoleQuery.workflowRunArchives.downloads.byDownloadId.get.queryOptions({
      input: downloadTaskId
        ? {
            params: {
              download_id: downloadTaskId,
            },
          }
        : skipToken,
      enabled: !!downloadTaskId && isPreparingStatus(cachedTask?.status),
      refetchInterval: (query) =>
        isPreparingStatus(query.state.data?.status ?? cachedTask?.status)
          ? DOWNLOAD_TASK_POLLING_INTERVAL
          : false,
    }),
  )
  const createDownloadMutation = useMutation(
    consoleQuery.workflowRunArchives.downloads.post.mutationOptions(),
  )
  const currentTask = taskQuery.data ?? cachedTask
  const isPreparing = createDownloadMutation.isPending || isPreparingStatus(currentTask?.status)
  const isReady = currentTask?.status === 'ready'
  const isFailed = currentTask?.status === 'failed'
  const failureReason = isFailed ? currentTask?.error?.trim() : undefined
  const downloadHint = isReady
    ? t('archives.downloadHint.ready', { ns: 'appLog' })
    : isFailed
      ? failureReason
        ? t('archives.downloadHint.failedWithReason', { ns: 'appLog', reason: failureReason })
        : t('archives.downloadHint.failed', { ns: 'appLog' })
      : isPreparing
        ? t('archives.downloadHint.preparing', { ns: 'appLog' })
        : t('archives.downloadHint.prepare', { ns: 'appLog' })

  const prepareDownload = () => {
    if (createDownloadMutation.isPending) return

    createDownloadMutation.mutate(
      {
        body: {
          year: archive.year,
          month: archive.month,
        },
      },
      {
        onSuccess: (task) => {
          setDownloadTask(task)
          const messageKey =
            task.status === 'ready'
              ? 'archives.action.downloadReady'
              : 'archives.action.prepareStarted'
          toast.success(t(messageKey, { ns: 'appLog' }))
        },
        onError: () => {
          toast.error(t('archives.action.prepareFailed', { ns: 'appLog' }))
        },
      },
    )
  }

  const downloadArchive = () => {
    if (!currentTask || currentTask.status !== 'ready') return

    globalThis.location.assign(buildArchiveDownloadFileUrl(currentTask.download_id))
  }

  const buttonContent = (() => {
    if (isPreparing) return t('archives.action.preparing', { ns: 'appLog' })
    if (isReady) return t('operation.download', { ns: 'common' })
    if (isFailed) return t('operation.retry', { ns: 'common' })
    return t('archives.action.prepareDownload', { ns: 'appLog' })
  })()

  const buttonAriaLabel = isReady
    ? t('archives.action.downloadMonth', { ns: 'appLog', month: archiveMonth })
    : t('archives.action.prepareMonth', { ns: 'appLog', month: archiveMonth })
  const buttonIconClassName = isReady ? 'i-ri-download-2-line' : 'i-ri-inbox-archive-line'
  const onAction = isReady ? downloadArchive : prepareDownload

  return (
    <div
      className={cn(
        'grid min-h-15 items-center gap-3 border-b border-divider-subtle px-4 py-3 last:border-b-0',
        tableGridClassName,
      )}
    >
      <div className="min-w-0 text-center">
        <span className="truncate system-sm-semibold text-text-primary">{archiveMonth}</span>
      </div>
      <div className="text-center system-sm-medium text-text-secondary tabular-nums">
        {formatNumber(archive.workflow_run_count)}
      </div>
      <div className="text-center system-sm-medium text-text-secondary tabular-nums">
        {formatBytes(archive.archive_bytes)}
      </div>
      <div className="flex min-w-0 justify-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="small"
                variant="secondary"
                loading={isPreparing}
                disabled={isPreparing}
                className="gap-1 px-2"
                aria-label={buttonAriaLabel}
                onClick={onAction}
              >
                {!isPreparing && (
                  <span className={cn(buttonIconClassName, 'size-3.5')} aria-hidden="true" />
                )}
                {buttonContent}
              </Button>
            }
          />
          <TooltipContent
            placement="top"
            className={cn(
              'max-w-[260px] text-center text-text-tertiary',
              isFailed && 'max-w-[300px] text-start [overflow-wrap:anywhere] whitespace-pre-wrap',
            )}
          >
            {downloadHint}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
