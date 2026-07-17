'use client'

import type { ContactImSafeReason, ContactImSyncResult } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContactImSyncItems, useContactImSyncRun } from './hooks'
import {
  ContactImSyncStatus,
  ContactImSafeReason as SafeReason,
  ContactImSyncResult as SyncResult,
} from './types'

const ALL_RESULTS = 'all'

const resultToneClassNames = {
  [SyncResult.CreatedBinding]: 'bg-state-accent-hover text-text-accent',
  [SyncResult.Failed]: 'bg-state-destructive-hover text-text-destructive',
  [SyncResult.Matched]: 'bg-state-success-hover text-text-success',
  [SyncResult.Skipped]: 'bg-background-default-subtle text-text-tertiary',
  [SyncResult.Unmatched]: 'bg-state-warning-hover text-text-warning',
  [SyncResult.UpdatedBinding]: 'bg-state-accent-hover text-text-accent',
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
  const [resultFilter, setResultFilter] = useState<ContactImSyncResult | undefined>()
  const runQuery = useContactImSyncRun(runId)
  const itemsQuery = useContactImSyncItems({ pageSize: 2, result: resultFilter, runId })
  const run = runQuery.data
  const items = itemsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const resultLabels = {
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
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  const initialLoadFailed =
    runQuery.isError || (itemsQuery.isError && !itemsQuery.data && !itemsQuery.isFetchNextPageError)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[760px] max-h-[calc(100dvh-2rem)] w-[840px] flex-col overflow-hidden! p-0!">
        <DialogCloseButton aria-label={tCommon(($) => $['operation.close'])} />
        <div className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['imPlatform.details.title'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {run
              ? t(($) => $['imPlatform.details.metadata'], {
                  date: formatDate(run.completedAt ?? run.startedAt),
                  status: statusLabels[run.status],
                  user: run.startedBy,
                })
              : t(($) => $['imPlatform.details.description'])}
          </DialogDescription>
          {run?.safeError && (
            <div role="alert" className="mt-3 system-xs-regular text-text-destructive">
              {safeReasonLabels[run.safeError]}
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
                void itemsQuery.refetch()
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
            <div className="shrink-0 overflow-x-auto border-y border-divider-subtle px-6 py-3">
              <SegmentedControl
                aria-label={t(($) => $['imPlatform.details.filters'])}
                value={[resultFilter ?? ALL_RESULTS]}
                onValueChange={(values) => {
                  const value = values[0]
                  if (!value) return
                  setResultFilter(
                    value === ALL_RESULTS ? undefined : (value as ContactImSyncResult),
                  )
                }}
              >
                <SegmentedControlItem value={ALL_RESULTS}>
                  {t(($) => $['imPlatform.details.filter.all'])}{' '}
                  {Object.values(run.counts).reduce((sum, count) => sum + count, 0)}
                </SegmentedControlItem>
                {Object.values(SyncResult).map((result) => (
                  <SegmentedControlItem key={result} value={result}>
                    {resultLabels[result]} {run.counts[result]}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
              <table className="w-full min-w-[752px] table-fixed border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-components-panel-bg">
                  <tr className="border-b border-divider-subtle">
                    <th className="w-1/2 px-3 py-2 system-xs-medium-uppercase text-text-tertiary">
                      {t(($) => $['imPlatform.details.column.contact'])}
                    </th>
                    <th className="w-1/2 px-3 py-2 system-xs-medium-uppercase text-text-tertiary">
                      {t(($) => $['imPlatform.details.column.platform'])}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-divider-subtle align-top">
                      <td className="px-3 py-3">
                        <div className="system-sm-medium text-text-primary">
                          {item.matchedContact?.name ?? missing}
                        </div>
                        <div className="mt-0.5 system-xs-regular text-text-tertiary">
                          {item.matchedContact?.email ?? missing}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate system-sm-medium text-text-primary">
                              {item.platformIdentity.displayName ?? missing}
                            </div>
                            <div className="mt-0.5 truncate system-xs-regular text-text-tertiary">
                              {item.platformIdentity.email ?? missing}
                            </div>
                            <div className="mt-0.5 truncate system-xs-regular text-text-tertiary">
                              {item.platformIdentity.platformUserId ?? missing}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-md px-2 py-1 system-xs-medium ${resultToneClassNames[item.result]}`}
                          >
                            {resultLabels[item.result]}
                          </span>
                        </div>
                        {item.safeReason && (
                          <div className="mt-2 system-xs-regular text-text-tertiary">
                            {safeReasonLabels[item.safeReason]}
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
