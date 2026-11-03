import type { GetAppsByAppIdTraceRunsBySourceKindBySourceIdResponse } from '@dify/contracts/api/console/apps/types.gen'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { hasProviderForm } from '@/app/components/app/tracing/providers'
import { consoleQuery } from '@/service/console'
import { MetaDataRow } from './meta'

export type ExternalTraceSource =
  | { appId: string; kind: 'workflow'; workflowRunId: string; nodeExecutionId?: string }
  | { appId: string; kind: 'node'; nodeExecutionId: string }
  | { agentId: string; kind: 'agent'; messageId: string }

type TraceRunStatus = GetAppsByAppIdTraceRunsBySourceKindBySourceIdResponse['status']

/** The workflow run whose Agent node executions can locate their own external spans. */
export type ExternalTraceRun = { appId: string; workflowRunId: string }

const pendingStatuses = [
  'collecting',
  'ready',
  'exporting',
  'retrying',
] as const satisfies readonly TraceRunStatus[]

const isPending = (status: TraceRunStatus): status is (typeof pendingStatuses)[number] =>
  pendingStatuses.some((pending) => pending === status)

const statusDots = {
  pending: 'normal',
  accepted: 'success',
  failed: 'error',
  uncertain: 'warning',
} as const

export function ExternalTraceRow({
  source,
  subject,
}: {
  source: ExternalTraceSource
  /** Names what the link opens when several rows can be on screen, e.g. the node title. */
  subject?: string
}) {
  const { t } = useTranslation(['app', 'common'])
  const hintId = useId()
  const { data: run } = useQuery(
    source.kind === 'agent'
      ? consoleQuery.agent.byAgentId.traceRuns.byMessageId.get.queryOptions({
          input: { params: { agent_id: source.agentId, message_id: source.messageId } },
          refetchInterval: (query) => {
            const status = query.state.data?.status
            return status && isPending(status) ? 3000 : false
          },
        })
      : consoleQuery.apps.byAppId.traceRuns.bySourceKind.bySourceId.get.queryOptions({
          input:
            source.kind === 'workflow'
              ? {
                  params: {
                    app_id: source.appId,
                    source_kind: 'workflow',
                    source_id: source.workflowRunId,
                  },
                  ...(source.nodeExecutionId
                    ? { query: { node_execution_id: source.nodeExecutionId } }
                    : {}),
                }
              : {
                  params: {
                    app_id: source.appId,
                    source_kind: 'node',
                    source_id: source.nodeExecutionId,
                  },
                },
          refetchInterval: (query) => {
            const status = query.state.data?.status
            return status && isPending(status) ? 3000 : false
          },
        }),
  )

  if (!run || run.status === 'not_collected') return null

  const state = isPending(run.status) ? 'pending' : run.status
  const providerId = run.provider
  const provider = hasProviderForm(providerId)
    ? t(($) => $[`tracing.${providerId}.title`], { ns: 'app' })
    : (providerId ?? '')
  const link =
    state === 'failed'
      ? null
      : run.span_url
        ? { href: run.span_url, label: t(($) => $['tracing.run.viewSpan'], { ns: 'app' }) }
        : run.trace_url
          ? { href: run.trace_url, label: t(($) => $['tracing.run.viewTrace'], { ns: 'app' }) }
          : run.project_url
            ? {
                href: run.project_url,
                label: t(($) => $['tracing.run.viewProject'], { ns: 'app' }),
              }
            : null

  return (
    <MetaDataRow label={t(($) => $['tracing.run.title'], { ns: 'app' })}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5">
          <StatusDot size="small" status={statusDots[state]} />
          {t(($) => $[`tracing.run.${state}`], { ns: 'app', provider })}
        </span>
        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={hintId}
            className="inline-flex items-center gap-0.5 rounded-sm text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {link.label}
            {subject && <span className="sr-only">{` ${subject}`}</span>}
            <span aria-hidden className="i-ri-external-link-line size-3" />
            <span id={hintId} hidden>
              {t(($) => $['operation.openInNewTab'], { ns: 'common' })}
            </span>
          </a>
        )}
      </span>
    </MetaDataRow>
  )
}
