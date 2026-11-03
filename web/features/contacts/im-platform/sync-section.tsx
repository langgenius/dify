'use client'

import type { ChannelSummary } from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { useContactsImPlatformOrganization } from './composition-context'
import { CONTACT_IM_SYNC_POLL_INTERVAL_MS } from './hooks'

export function ContactImDirectorySyncSection({
  integration,
  onViewDetails,
}: {
  integration: ChannelSummary
  onViewDetails: (runId: string) => void
}) {
  const { t } = useTranslation(['contacts'])
  const { canManage } = useContactsImPlatformOrganization()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const api = consoleQuery.workspaces.current.humanInput.v2.imSyncRuns
  const runQuery = useQuery(
    api.latest.get.queryOptions({
      context: { silent: true },
      retry: (count, error) => getHttpErrorStatus(error) !== 404 && count < 2,
      refetchInterval: ({ state }) =>
        state.data?.run.status === 'queued' || state.data?.run.status === 'running'
          ? CONTACT_IM_SYNC_POLL_INTERVAL_MS
          : false,
    }),
  )
  const startSync = useMutation(api.post.mutationOptions({ context: { silent: true } }))
  const queryClient = useQueryClient()
  const previousRunRef = useRef<{ id: string; active: boolean } | null>(null)
  const run = runQuery.data?.run
  const active = run?.status === 'queued' || run?.status === 'running'
  useEffect(() => {
    if (!run) return
    const previous = previousRunRef.current
    previousRunRef.current = { id: run.id, active }
    if (previous && previous.id !== run.id) {
      void queryClient.resetQueries({ queryKey: api.latest.results.key() })
    }
    if (previous?.id === run.id && previous.active && !active) {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.humanInput.v2.contacts.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.humanInput.v2.contactOptions.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.humanInput.v2.imIdentities.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.humanInput.v2.channels.key(),
        }),
        queryClient.invalidateQueries({ queryKey: api.latest.results.key() }),
      ])
    }
  }, [active, api.latest.results, queryClient, run])
  const requestError = runQuery.isError && getHttpErrorStatus(runQuery.error) !== 404
  const date = run?.finished_at ?? run?.started_at
  const statusLabels = {
    failed: t(($) => $['imPlatform.sync.status.failure']),
    queued: t(($) => $['imPlatform.sync.status.queued']),
    running: t(($) => $['imPlatform.sync.status.running']),
    succeeded: t(($) => $['imPlatform.sync.status.success']),
  }
  const labelId = useId()
  const reasonId = useId()
  const reason = !canManage
    ? t(($) => $['imPlatform.sync.noPermission'])
    : integration.status !== 'connected'
      ? t(($) => $['imPlatform.sync.notConnected'])
      : runQuery.isPending
        ? t(($) => $['imPlatform.sync.loading'])
        : requestError
          ? t(($) => $['imPlatform.sync.startFailed'])
          : undefined
  return (
    <div className="mt-2 rounded-xl bg-background-section-burn px-4 py-3">
      <div role="status" aria-atomic="true" className="sr-only">
        {run ? `${integration.display_identifier}: ${statusLabels[run.status]}` : ''}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 system-xs-regular text-text-tertiary">
          <span aria-hidden className="i-ri-loop-left-line size-3 shrink-0" />
          {run ? (
            active ? (
              <span>{statusLabels[run.status]}</span>
            ) : (
              <>
                <span>
                  {t(($) => $['imPlatform.sync.latestSynced'], {
                    date: date
                      ? formatTimeFromNow(date * 1000)
                      : t(($) => $['imPlatform.details.missing']),
                  })}
                </span>
                <span aria-hidden className="mx-1 h-3 w-px bg-divider-regular" />
                <Button
                  className="h-auto shrink-0 rounded-none px-0 font-normal hover:bg-transparent hover:underline"
                  onClick={() => onViewDetails(run.id)}
                  size="small"
                  variant="ghost-accent"
                >
                  {t(($) => $['imPlatform.action.viewDetails'])}
                </Button>
              </>
            )
          ) : (
            <span>
              {runQuery.isPending
                ? t(($) => $['imPlatform.sync.loading'])
                : t(($) => $['imPlatform.sync.noRuns'])}
            </span>
          )}
        </div>
        <Button
          aria-labelledby={labelId}
          aria-describedby={reason ? reasonId : undefined}
          disabled={Boolean(reason)}
          focusableWhenDisabled
          loading={startSync.isPending || active}
          onClick={() => startSync.mutate(undefined)}
          size="small"
        >
          <span id={labelId}>
            {startSync.isPending || active
              ? t(($) => $['imPlatform.action.syncing'])
              : t(($) => $['imPlatform.action.syncNow'])}
          </span>
        </Button>
      </div>
      {reason && (
        <div id={reasonId} className="mt-2 system-xs-regular text-text-tertiary">
          {reason}
        </div>
      )}
      {(requestError || startSync.isError) && (
        <div role="alert" className="mt-2 system-xs-regular text-text-destructive">
          {t(($) => $['imPlatform.sync.startFailed'])}
          {requestError && (
            <Button className="ms-3" onClick={() => runQuery.refetch()} size="small">
              {t(($) => $['imPlatform.action.retry'])}
            </Button>
          )}
        </div>
      )}
      {run?.status === 'failed' && (
        <div className="mt-2 system-xs-regular text-text-destructive">
          {run.error_message ?? statusLabels.failed}
        </div>
      )}
    </div>
  )
}
