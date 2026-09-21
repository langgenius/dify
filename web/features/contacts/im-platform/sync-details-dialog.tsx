'use client'

import type { ContactImSafeReason, ContactImSyncResult } from './types'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  SegmentedControl,
  SegmentedControlDivider,
  SegmentedControlItem,
} from '@langgenius/dify-ui/segmented-control'
import { useMutation } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { jsonToCSV } from 'react-papaparse'
import { downloadBlob } from '@/utils/download'
import { ContactChannelIcon } from '../management/channel-icon'
import { useContactsImPlatformRepository } from './composition-context'
import { useContactImSyncItems, useContactImSyncRun } from './hooks'
import { loadContactImSyncReport } from './repository'
import {
  ContactImRepositoryError,
  ContactImRepositoryErrorCode,
  ContactImSyncStatus,
  ContactImSafeReason as SafeReason,
  ContactImSyncResult as SyncResult,
} from './types'

const results = [
  SyncResult.Added,
  SyncResult.NotMatched,
  SyncResult.Failed,
  SyncResult.Removed,
  SyncResult.Skipped,
]

const resultToneClassNames = {
  [SyncResult.Added]: 'border-text-accent text-text-accent',
  [SyncResult.NotMatched]: 'border-divider-deep text-text-tertiary',
  [SyncResult.Removed]: 'border-text-warning text-text-warning',
  [SyncResult.CreatedBinding]: 'border-text-accent text-text-accent',
  [SyncResult.Failed]: 'border-text-destructive text-text-destructive',
  [SyncResult.Matched]: 'border-divider-deep text-text-tertiary',
  [SyncResult.Skipped]: 'border-divider-deep text-text-tertiary',
  [SyncResult.Unmatched]: 'border-divider-deep text-text-tertiary',
  [SyncResult.UpdatedBinding]: 'border-text-accent text-text-accent',
} satisfies Record<ContactImSyncResult, string>

export function ContactImSyncDetailsDialog({
  open,
  runId,
  onOpenChange,
}: {
  open: boolean
  runId: string
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation('contacts')
  const { t: tCommon } = useTranslation('common')
  const repository = useContactsImPlatformRepository()
  const reportDownload = useMutation({
    mutationFn: (id: string) => loadContactImSyncReport(repository, id),
    onSuccess: ({ run: reportRun, items: reportItems }) => {
      const content = jsonToCSV(
        {
          fields: [
            'run_id',
            'result',
            'contact_id',
            'contact_name',
            'contact_email',
            'provider',
            'platform_user_id',
            'platform_display_name',
            'platform_email',
            'reason',
          ],
          data: reportItems.map((item) => [
            reportRun.id,
            item.result,
            item.matchedContact?.id ?? '',
            item.matchedContact?.name ?? '',
            item.matchedContact?.email ?? '',
            reportRun.provider ?? '',
            item.platformIdentity.platformUserId ?? '',
            item.platformIdentity.displayName ?? '',
            item.platformIdentity.email ?? '',
            item.reason ?? item.safeReason ?? '',
          ]),
        },
        { escapeFormulae: /^[\t\r\n]|^\s*[=+\-@]/ },
      )
      downloadBlob({
        data: new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' }),
        fileName: `im-sync-${reportRun.id}.csv`,
      })
    },
  })
  const [resultFilter, setResultFilter] = useState<ContactImSyncResult>(SyncResult.Added)
  const runQuery = useContactImSyncRun(open ? runId : null)
  const run = runQuery.data
  const itemsQuery = useContactImSyncItems({
    enabled: open && Boolean(run),
    pageSize: 20,
    result: resultFilter,
    runId: run?.id ?? runId,
  })
  const items = itemsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const resultLabels = {
    [SyncResult.Added]: t(($) => $['imPlatform.details.filter.added']),
    [SyncResult.NotMatched]: t(($) => $['imPlatform.details.filter.not_matched']),
    [SyncResult.Removed]: t(($) => $['imPlatform.details.filter.removed']),
    [SyncResult.CreatedBinding]: t(($) => $['imPlatform.details.filter.created_binding']),
    [SyncResult.Failed]: t(($) => $['imPlatform.details.filter.failed']),
    [SyncResult.Matched]: t(($) => $['imPlatform.details.filter.matched']),
    [SyncResult.Skipped]: t(($) => $['imPlatform.details.filter.skipped']),
    [SyncResult.Unmatched]: t(($) => $['imPlatform.details.filter.unmatched']),
    [SyncResult.UpdatedBinding]: t(($) => $['imPlatform.details.filter.updated_binding']),
  }
  const statusLabels = {
    [ContactImSyncStatus.Failure]: t(($) => $['imPlatform.sync.status.failure']),
    [ContactImSyncStatus.PartialSuccess]: t(($) => $['imPlatform.sync.status.partial_success']),
    [ContactImSyncStatus.Queued]: t(($) => $['imPlatform.sync.status.queued']),
    [ContactImSyncStatus.Running]: t(($) => $['imPlatform.sync.status.running']),
    [ContactImSyncStatus.Success]: t(($) => $['imPlatform.sync.status.success']),
  }
  const safeReasonLabels = {
    [SafeReason.ContactUpdateFailed]: t(
      ($) => $['imPlatform.details.safeReason.contact_update_failed'],
    ),
    [SafeReason.DuplicateIdentity]: t(($) => $['imPlatform.details.safeReason.duplicate_identity']),
    [SafeReason.MissingEmail]: t(($) => $['imPlatform.details.safeReason.missing_email']),
    [SafeReason.NoMatchingContact]: t(
      ($) => $['imPlatform.details.safeReason.no_matching_contact'],
    ),
    [SafeReason.ProviderRequestFailed]: t(
      ($) => $['imPlatform.details.safeReason.provider_request_failed'],
    ),
  } satisfies Record<ContactImSafeReason, string>
  const missing = t(($) => $['imPlatform.details.missing'])
  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(value))
      : missing
  const initialLoadFailed =
    runQuery.isError || (itemsQuery.isError && !itemsQuery.data && !itemsQuery.isFetchNextPageError)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-180 max-h-[calc(100dvh-2rem)] w-[693px] flex-col overflow-hidden! p-0!">
        <DialogClose
          render={
            <IconButton
              aria-label={tCommon(($) => $['operation.close'])}
              className="absolute top-5 right-5"
              size="lg"
            >
              <span aria-hidden className="i-ri-close-line size-4.5" />
            </IconButton>
          }
        />
        <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['imPlatform.details.title'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {run
              ? run.status === ContactImSyncStatus.Success
                ? run.startedBy
                  ? t(($) => $['imPlatform.sync.lastSynced'], {
                      date: formatDate(run.completedAt ?? run.startedAt),
                      user: run.startedBy,
                    })
                  : t(($) => $['imPlatform.sync.latestSynced'], {
                      date: formatDate(run.completedAt ?? run.startedAt),
                    })
                : t(($) => $['imPlatform.details.latestMetadata'], {
                    date: formatDate(run.completedAt ?? run.startedAt),
                    status: statusLabels[run.status],
                  })
              : t(($) => $['imPlatform.details.description'])}
          </DialogDescription>
          {(run?.errorMessage || run?.safeError) && (
            <div role="alert" className="mt-3 system-xs-regular text-text-destructive">
              {run.errorMessage ?? (run.safeError ? safeReasonLabels[run.safeError] : null)}
            </div>
          )}
        </div>

        {initialLoadFailed ? (
          <div role="alert" className="m-6 mt-2 rounded-xl bg-background-default-subtle p-5">
            <div className="system-sm-medium text-text-primary">
              {t(($) => $['imPlatform.details.loadError'])}
            </div>
            <Button
              className="mt-3"
              onClick={() => {
                void runQuery.refetch()
                if (run) void itemsQuery.refetch()
              }}
            >
              {t(($) => $['imPlatform.action.retry'])}
            </Button>
          </div>
        ) : runQuery.isPending || itemsQuery.isPending || !run ? (
          <div
            role="status"
            aria-label={t(($) => $['imPlatform.details.loading'])}
            className="m-6 mt-2 h-32 animate-pulse rounded-xl bg-state-base-active motion-reduce:animate-none"
          />
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-6 py-1">
              <div className="min-w-0 overflow-x-auto">
                <SegmentedControl
                  aria-label={t(($) => $['imPlatform.details.filters'])}
                  value={resultFilter}
                  onValueChange={(value) => {
                    const result = results.find((result) => result === value)
                    if (result) setResultFilter(result)
                  }}
                >
                  {results.map((result, index) => (
                    <Fragment key={result}>
                      {index > 0 && (
                        <SegmentedControlDivider
                          className={cn(
                            '-mx-px',
                            (resultFilter === result || resultFilter === results[index - 1]) &&
                              'invisible',
                          )}
                        />
                      )}
                      <SegmentedControlItem
                        className="gap-1 px-2.5 data-checked:text-text-primary"
                        value={result}
                      >
                        {resultLabels[result]}{' '}
                        <span
                          className={cn(
                            'min-w-4 rounded-[5px] border px-0.75 text-center text-[10px] leading-3 font-medium',
                            resultToneClassNames[result],
                          )}
                        >
                          {run.counts[result] ?? 0}
                        </span>
                      </SegmentedControlItem>
                    </Fragment>
                  ))}
                </SegmentedControl>
              </div>
              <Button
                className="shrink-0"
                disabled={
                  run.status === ContactImSyncStatus.Queued ||
                  run.status === ContactImSyncStatus.Running
                }
                loading={reportDownload.isPending}
                onClick={() => reportDownload.mutate(run.id)}
              >
                <span aria-hidden className="i-ri-download-line size-4" />
                {reportDownload.isPending
                  ? t(($) => $['imPlatform.details.downloadingReport'])
                  : t(($) => $['imPlatform.details.downloadReport'])}
              </Button>
            </div>

            {reportDownload.isError && (
              <div role="alert" className="px-6 pt-2 system-xs-regular text-text-destructive">
                {reportDownload.error instanceof ContactImRepositoryError &&
                reportDownload.error.code === ContactImRepositoryErrorCode.SyncRunNotFound
                  ? t(($) => $['imPlatform.details.reportChanged'])
                  : t(($) => $['imPlatform.details.downloadFailed'])}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto px-6 pt-2 pb-6">
              <table className="w-full table-fixed border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-background-section-burn">
                  <tr>
                    <th className="w-1/2 rounded-l-lg px-3 py-1.5 system-xs-medium-uppercase text-text-tertiary">
                      {t(($) => $['imPlatform.details.column.contact'])}
                    </th>
                    <th className="w-1/2 rounded-r-lg px-3 py-1.5 system-xs-medium-uppercase text-text-tertiary">
                      {t(($) => $['imPlatform.details.column.platform'])}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="h-12 border-b border-divider-subtle">
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2.5">
                          {item.matchedContact && (
                            <Avatar
                              avatar={item.matchedContact.avatarUrl ?? null}
                              name={item.matchedContact.name}
                              size="md"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="truncate system-md-medium text-text-secondary">
                              {item.matchedContact?.name ?? missing}
                            </div>
                            {item.matchedContact?.email && (
                              <div className="truncate system-xs-regular text-text-tertiary">
                                {item.matchedContact.email}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex max-w-full items-center gap-1 rounded-md border py-0.75 pr-2 pl-1 system-sm-regular',
                              resultToneClassNames[item.result],
                              item.result === SyncResult.Added && 'text-text-secondary',
                            )}
                          >
                            {run.provider && (
                              <ContactChannelIcon className="size-4" provider={run.provider} />
                            )}
                            <span className="truncate">
                              {item.platformIdentity.displayName ??
                                item.platformIdentity.email ??
                                item.platformIdentity.platformUserId ??
                                missing}
                            </span>
                          </span>
                        </div>
                        {(item.reason || item.safeReason) && (
                          <div className="mt-2 system-xs-regular text-text-tertiary">
                            {item.reason ??
                              (item.safeReason ? safeReasonLabels[item.safeReason] : null)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {items.length === 0 && (
                <div className="py-12 text-center system-sm-regular text-text-tertiary">
                  {t(($) => $['imPlatform.details.empty'])}
                </div>
              )}

              {itemsQuery.isFetchNextPageError && (
                <div role="alert" className="mt-3 flex items-center justify-between gap-3">
                  <span className="system-xs-regular text-text-destructive">
                    {t(($) => $['imPlatform.details.pageError'])}
                  </span>
                  <Button onClick={() => itemsQuery.fetchNextPage()}>
                    {t(($) => $['imPlatform.action.retry'])}
                  </Button>
                </div>
              )}

              {itemsQuery.hasNextPage && !itemsQuery.isFetchNextPageError && (
                <div className="mt-4 flex justify-center">
                  <Button
                    loading={itemsQuery.isFetchingNextPage}
                    onClick={() => itemsQuery.fetchNextPage()}
                  >
                    {t(($) => $['imPlatform.action.loadMore'])}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
