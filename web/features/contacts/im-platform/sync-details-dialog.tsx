'use client'

import type { ImSyncResultItem } from '@dify/contracts/api/console/workspaces/types.gen'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { downloadBlob } from '@/utils/download'
import { ContactChannelIcon } from '../management/channel-icon'
import { loadContactImSyncReport, syncResults } from './sync-report'
import { useContactImSyncResultUrlState } from './sync-run-url-state'
import { ContactImRepositoryError, ContactImRepositoryErrorCode } from './types'

export function ContactImSyncDetailsDialog({
  open,
  runId,
  onOpenChange,
}: {
  open: boolean
  runId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [displayedRunId, setDisplayedRunId] = useState(runId)
  const subject = runId ?? displayedRunId
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setDisplayedRunId(runId)
        onOpenChange(nextOpen)
      }}
      onOpenChangeComplete={(nextOpen) => {
        setDisplayedRunId(nextOpen ? runId : null)
      }}
    >
      <DialogContent className="h-180 w-173.25">
        {subject && <SyncDetailsContent key={subject} runId={subject} />}
      </DialogContent>
    </Dialog>
  )
}

function SyncDetailsContent({ runId }: { runId: string }) {
  const { t, i18n } = useTranslation(['contacts'])
  const { t: tCommon } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const [result, setResult] = useContactImSyncResultUrlState()
  const titleId = useId()
  const downloadLabelId = useId()
  const api = consoleQuery.workspaces.current.humanInput.v2.imSyncRuns.latest
  const runQuery = useQuery(
    api.get.queryOptions({
      context: { silent: true },
    }),
  )
  const run = runQuery.data?.run
  const matchesRun = Boolean(run && (runId === 'latest' || run.id === runId))
  const canReadResults = matchesRun && run?.status !== 'queued' && run?.status !== 'running'
  const itemsQuery = useInfiniteQuery(
    api.results.get.infiniteOptions({
      input: canReadResults
        ? (page: number) => ({ query: { result, page, limit: 20 } })
        : skipToken,
      initialPageParam: 1,
      getNextPageParam: (page) => (page.page * page.limit < page.total ? page.page + 1 : undefined),
      context: { silent: true },
    }),
  )
  const items = itemsQuery.data?.pages.flatMap((page) => page.data) ?? []
  const labels = {
    added: t(($) => $['imPlatform.details.filter.added']),
    not_matched: t(($) => $['imPlatform.details.filter.not_matched']),
    failed: t(($) => $['imPlatform.details.filter.failed']),
    removed: t(($) => $['imPlatform.details.filter.removed']),
    skipped: t(($) => $['imPlatform.details.filter.skipped']),
  }
  const statuses = {
    failed: t(($) => $['imPlatform.sync.status.failure']),
    queued: t(($) => $['imPlatform.sync.status.queued']),
    running: t(($) => $['imPlatform.sync.status.running']),
    succeeded: t(($) => $['imPlatform.sync.status.success']),
  }
  const removalReasons = {
    not_present_in_directory: t(
      ($) => $['imPlatform.details.removalReason.not_present_in_directory'],
    ),
    binding_replaced: t(($) => $['imPlatform.details.removalReason.binding_replaced']),
    binding_invalidated: t(($) => $['imPlatform.details.removalReason.binding_invalidated']),
  }
  const reason = (item: ImSyncResultItem) =>
    item.result.type === 'removed'
      ? removalReasons[item.result.reason]
      : item.result.type === 'failed'
        ? item.result.reason
        : ''
  const report = useMutation({
    mutationFn: async () => {
      const { run: reportRun, items: reportItems } = await loadContactImSyncReport(
        queryClient,
        runId === 'latest' && run ? run.id : runId,
      )
      const { jsonToCSV } = await import('react-papaparse')
      const csv = jsonToCSV(
        {
          fields: [
            'run_id',
            'result',
            'contact_id',
            'contact_name',
            'provider',
            'platform_user_id',
            'platform_display_name',
            'platform_email',
            'reason',
          ],
          data: reportItems.map((item) => {
            const row = item.result
            const contact = 'contact' in row ? row.contact : null
            const entry = row.type === 'removed' ? row.last_known_identity : row.entry
            return [
              reportRun.id,
              labels[row.type],
              contact?.id ?? '',
              contact?.name ?? '',
              reportRun.provider,
              entry?.provider_user_id ?? '',
              entry?.display_name ?? '',
              entry?.email ?? '',
              reason(item),
            ]
          }),
        },
        { escapeFormulae: /^[\t\r\n]|^\s*[=+\-@]/ },
      )
      downloadBlob({
        data: new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }),
        fileName: `im-sync-${reportRun.id}.csv`,
      })
    },
  })
  const missing = t(($) => $['imPlatform.details.missing'])
  const date = run?.finished_at ?? run?.started_at
  const formattedDate = date
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(date * 1000),
      )
    : missing
  return (
    <>
      <DialogHeader>
        <DialogHeaderCloseButton aria-label={tCommon(($) => $['operation.close'])} />
        <DialogTitle id={titleId}>{t(($) => $['imPlatform.details.title'])}</DialogTitle>
        <DialogDescription>
          {run
            ? t(($) => $['imPlatform.details.latestMetadata'], {
                date: formattedDate,
                status: statuses[run.status],
              })
            : t(($) => $['imPlatform.details.description'])}
        </DialogDescription>
      </DialogHeader>
      <div role="status" aria-atomic="true" className="sr-only">
        {run ? `${statuses[run.status]} · ${labels[result]}: ${items.length}` : ''}
      </div>
      <DialogBody>
        {runQuery.isError || (itemsQuery.isError && !itemsQuery.data) ? (
          <div role="alert">
            <p>{t(($) => $['imPlatform.details.loadError'])}</p>
            <Button
              onClick={() => {
                void runQuery.refetch()
                if (canReadResults) void itemsQuery.refetch()
              }}
            >
              {t(($) => $['imPlatform.action.retry'])}
            </Button>
          </div>
        ) : run && !matchesRun ? (
          <div role="alert">{t(($) => $['imPlatform.details.reportChanged'])}</div>
        ) : !run || itemsQuery.isPending ? (
          <div aria-busy="true" className="h-32 animate-pulse rounded-xl bg-state-base-active" />
        ) : (
          <>
            {run.error_message && (
              <div role="alert" className="mb-3 text-text-destructive">
                {run.error_message}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedControl
                aria-label={t(($) => $['imPlatform.details.filters'])}
                value={result}
                onValueChange={(value) => {
                  const next = syncResults.find((result) => result === value)
                  if (next) void setResult(next)
                }}
              >
                {syncResults.map((result) => (
                  <SegmentedControlItem key={result} value={result}>
                    {labels[result]} <span>{run.result_counts[result]}</span>
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
              <Button
                aria-labelledby={downloadLabelId}
                disabled={run.status === 'queued' || run.status === 'running'}
                loading={report.isPending}
                onClick={() => report.mutate()}
              >
                <span aria-hidden className="i-ri-download-line size-4" />
                <span id={downloadLabelId}>
                  {report.isPending
                    ? t(($) => $['imPlatform.details.downloadingReport'])
                    : t(($) => $['imPlatform.details.downloadReport'])}
                </span>
              </Button>
            </div>
            {report.isError && (
              <div role="alert" className="pt-2 text-text-destructive">
                {report.error instanceof ContactImRepositoryError &&
                report.error.code === ContactImRepositoryErrorCode.SyncRunNotFound
                  ? t(($) => $['imPlatform.details.reportChanged'])
                  : t(($) => $['imPlatform.details.downloadFailed'])}
              </div>
            )}
            <table
              aria-labelledby={titleId}
              className="mt-3 w-full table-fixed border-collapse text-start"
            >
              <thead>
                <tr>
                  <th className="w-1/2 p-3 text-start system-xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['imPlatform.details.column.contact'])}
                  </th>
                  <th className="w-1/2 p-3 text-start system-xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['imPlatform.details.column.platform'])}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const row = item.result
                  const contact = 'contact' in row ? row.contact : null
                  const entry = row.type === 'removed' ? row.last_known_identity : row.entry
                  return (
                    <tr key={item.id} className="h-12 border-b border-divider-subtle">
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          {contact && (
                            <Avatar size="md" aria-hidden="true">
                              <AvatarImage src={contact.avatar_url ?? undefined} alt="" />
                              <AvatarFallback>
                                {contact.name[0]?.toLocaleUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <span className="truncate">{contact?.name ?? missing}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <ContactChannelIcon
                            className="size-4"
                            provider={run.provider === 'ding_talk' ? 'dingtalk' : run.provider}
                          />
                          <span className="truncate">
                            {entry?.display_name ??
                              entry?.email ??
                              entry?.provider_user_id ??
                              missing}
                          </span>
                        </div>
                        {reason(item) && (
                          <p className="mt-1 system-xs-regular text-text-tertiary">
                            {reason(item)}
                          </p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {items.length === 0 && (
              <p className="py-12 text-center">{t(($) => $['imPlatform.details.empty'])}</p>
            )}
            {itemsQuery.isFetchNextPageError && (
              <p role="alert" className="mt-3 text-text-destructive">
                {t(($) => $['imPlatform.details.pageError'])}
              </p>
            )}
            <div className="mt-4 flex justify-center">
              <Button
                disabled={!itemsQuery.hasNextPage}
                focusableWhenDisabled
                loading={itemsQuery.isFetchingNextPage}
                onClick={() => itemsQuery.fetchNextPage()}
              >
                {itemsQuery.isFetchNextPageError
                  ? t(($) => $['imPlatform.action.retry'])
                  : t(($) => $['imPlatform.action.loadMore'])}
              </Button>
            </div>
          </>
        )}
      </DialogBody>
    </>
  )
}
