'use client'

import type { TriggerLogEntry } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

const PAGE_SIZE = 20
const RUN_STATUSES = ['succeeded', 'failed', 'stopped', 'running'] as const
type RunStatus = (typeof RUN_STATUSES)[number]

// A log is pending until a runner starts it, failed when it never ran, and otherwise follows its run.
function logStatus(log: TriggerLogEntry): RunStatus | 'queued' {
  if (log.status === 'pending') return 'queued'
  if (log.status === 'failed') return 'failed'
  const status = log.run?.status
  return status && (RUN_STATUSES as readonly string[]).includes(status)
    ? (status as RunStatus)
    : 'running'
}

type EnvironmentTriggerLogsProps = {
  appId: string
  environmentId: string
  canManageAccessPoint: boolean
  onHide: () => void
}

export function EnvironmentTriggerLogs({
  appId,
  environmentId,
  canManageAccessPoint,
  onHide,
}: EnvironmentTriggerLogsProps) {
  const { t } = useTranslation(['appLog', 'common', 'deployments', 'workflow'])
  const queryClient = useQueryClient()
  const access = consoleQuery.enterprise.appDeploy.accessService
  const params = { app_id: appId, environment_id: environmentId }
  const logsQueryOptions = access.listTriggerLogs.infiniteOptions({
    context: { silent: true },
    initialPageParam: '',
    input: (cursor: string) => ({ params, query: { limit: PAGE_SIZE, cursor } }),
    getNextPageParam: (page) => (page.has_more ? page.next_cursor : undefined),
  })
  const logsQuery = useInfiniteQuery(logsQueryOptions)
  const rerunMutation = useMutation(
    access.rerunTriggerLog.mutationOptions({
      context: { silent: true },
      // The rerun is a new row at the top of this list.
      onSuccess: () => queryClient.invalidateQueries({ queryKey: logsQueryOptions.queryKey }),
      onError: (error) => {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        )
      },
    }),
  )
  const logs = logsQuery.data?.pages.flatMap((page) => page.data ?? []) ?? []
  const statusLabel = (status: RunStatus | 'queued') =>
    status === 'queued'
      ? t(($) => $['studio.accessPoint.triggerLogQueued'], { ns: 'deployments' })
      : t(($) => $[`status.${status}`], { ns: 'appLog' })

  return (
    <Dialog open onOpenChange={(open) => !open && onHide()}>
      <DialogContent className="w-200 max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{t(($) => $.title, { ns: 'appLog' })}</DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="min-w-0">
          {logsQuery.isPending && (
            <div className="flex flex-col gap-2" aria-busy="true">
              <span className="h-8 w-full animate-pulse rounded-lg bg-text-quaternary opacity-10 motion-reduce:animate-none" />
              <span className="h-8 w-full animate-pulse rounded-lg bg-text-quaternary opacity-10 motion-reduce:animate-none" />
            </div>
          )}
          {!logsQuery.isPending && logs.length === 0 && (
            <p className="py-8 text-center system-sm-regular text-text-tertiary">
              {t(($) => $['studio.accessPoint.triggerLogsEmpty'], { ns: 'deployments' })}
            </p>
          )}
          {logs.length > 0 && (
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr className="system-xs-medium-uppercase text-text-tertiary">
                  <th className="w-44 py-2 text-start font-medium">
                    {t(($) => $['table.header.startTime'], { ns: 'appLog' })}
                  </th>
                  <th className="py-2 text-start font-medium">
                    {t(($) => $['table.header.status'], { ns: 'appLog' })}
                  </th>
                  <th className="w-24 py-2 text-start font-medium">
                    {t(($) => $['table.header.runtime'], { ns: 'appLog' })}
                  </th>
                  <th className="w-24 py-2" />
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const status = logStatus(log)
                  const reason = log.run?.error || log.failure_reason
                  return (
                    <tr key={log.id} className="border-t border-divider-subtle align-top">
                      <td className="py-2 system-xs-regular text-text-secondary">
                        {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                      </td>
                      <td className="min-w-0 py-2">
                        <div className="flex items-center gap-1.5 system-xs-medium text-text-secondary">
                          <StatusDot
                            size="small"
                            status={
                              status === 'succeeded'
                                ? 'success'
                                : status === 'failed'
                                  ? 'error'
                                  : status === 'stopped'
                                    ? 'disabled'
                                    : 'warning'
                            }
                          />
                          {statusLabel(status)}
                          <span className="system-xs-regular text-text-tertiary">
                            {log.node_id}
                          </span>
                        </div>
                        {reason && (
                          <p className="mt-0.5 system-xs-regular break-all text-text-destructive">
                            {reason}
                          </p>
                        )}
                      </td>
                      <td className="py-2 system-xs-regular text-text-secondary">
                        {log.run?.duration !== undefined ? `${log.run.duration.toFixed(3)}s` : ''}
                      </td>
                      <td className="py-2 text-end">
                        {status !== 'queued' && status !== 'running' && (
                          <Button
                            size="small"
                            disabled={!canManageAccessPoint}
                            loading={
                              rerunMutation.isPending &&
                              rerunMutation.variables?.params.log_id === log.id
                            }
                            onClick={() =>
                              rerunMutation.mutate({
                                params: { ...params, log_id: log.id ?? '' },
                                body: {},
                              })
                            }
                          >
                            {t(($) => $['studio.accessPoint.triggerLogRerun'], {
                              ns: 'deployments',
                            })}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {logsQuery.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="secondary"
                loading={logsQuery.isFetchingNextPage}
                onClick={() => void logsQuery.fetchNextPage()}
              >
                {t(($) => $['common.loadMore'], { ns: 'workflow' })}
              </Button>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
