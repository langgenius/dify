'use client'

import type { ExternalTraceStepResponse } from '@dify/contracts/api/console/external-agent-invocations/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'

type TraceCursor = { offset: number; revision?: number }
function TraceRawData({ invocationId, stepKey }: { invocationId: string; stepKey: string }) {
  const { t } = useTranslation(['agentRoster'])
  const raw = useQuery(
    consoleQuery.externalAgentInvocations.byInvocationId.trace.steps.byStepKey.get.queryOptions({
      input: { params: { invocation_id: invocationId, step_key: stepKey } },
      context: { silent: true },
    }),
  )
  if (raw.error) return null
  return (
    <div className="border-t border-divider-subtle p-3">
      <h4 className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
        {t(($) => $['external.overview.testRun.rawData'])}
      </h4>
      {raw.isPending ? (
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['external.overview.testRun.waitingResult'])}
        </p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-md bg-background-section p-2 system-xs-regular wrap-anywhere whitespace-pre-wrap text-text-secondary">
          {JSON.stringify(raw.data.data, null, 2)}
        </pre>
      )}
    </div>
  )
}
function TraceStep({
  step,
  invocationId,
  children,
}: {
  step: ExternalTraceStepResponse
  invocationId: string
  children?: React.ReactNode
}) {
  const { t, i18n } = useTranslation(['agentRoster'])
  const [open, setOpen] = useState(false)
  const success =
    step.status !== null && ['success', 'succeeded', 'completed'].includes(step.status)
  const failed = step.status !== null && ['error', 'failed', 'failure'].includes(step.status)
  return (
    <li className="space-y-1">
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs"
      >
        <CollapsibleTrigger className="group flex min-h-9 w-full items-center rounded-[10px] py-2 ps-1.5 pe-3 text-start">
          <span
            aria-hidden
            className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary group-data-panel-open:rotate-90 rtl:-scale-x-100"
          />
          <span className="min-w-0 flex-1 system-sm-semibold wrap-anywhere text-text-secondary">
            {step.name ?? step.kind ?? step.key}
          </span>
          <span className="ms-2 shrink-0 system-xs-regular text-text-tertiary">
            {step.duration_seconds === null
              ? t(($) => $['external.overview.testRun.notProvided'])
              : t(($) => $['external.overview.testRun.elapsedValue'], {
                  value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
                    step.duration_seconds,
                  ),
                })}
          </span>
          {(success || failed) && (
            <span
              aria-hidden
              className={cn(
                'ms-2 size-4 shrink-0',
                success
                  ? 'i-ri-checkbox-circle-fill text-text-success'
                  : 'i-ri-close-circle-fill text-text-destructive',
              )}
            />
          )}
        </CollapsibleTrigger>
        <CollapsiblePanel>
          {open && <TraceRawData invocationId={invocationId} stepKey={step.key} />}
        </CollapsiblePanel>
      </Collapsible>
      {children}
    </li>
  )
}
function TraceSession({ invocationId }: { invocationId: string }) {
  const { t } = useTranslation(['agentRoster', 'workflow'])
  const client = useQueryClient()
  const options = consoleQuery.externalAgentInvocations.byInvocationId.trace.get.infiniteOptions({
    input: (cursor: TraceCursor) => ({
      params: { invocation_id: invocationId },
      query: { limit: 50, offset: cursor.offset, revision: cursor.revision },
    }),
    initialPageParam: { offset: 0 } as TraceCursor,
    getNextPageParam: (page) =>
      page.next_offset === null ? undefined : { offset: page.next_offset, revision: page.revision },
    context: { silent: true },
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.error || query.state.data?.pages[0]?.state !== 'collecting' ? false : 2_000,
  })
  const trace = useInfiniteQuery(options)
  const conflict = getHttpErrorStatus(trace.error) === 409
  useEffect(() => {
    if (conflict) void client.resetQueries({ queryKey: options.queryKey, exact: true })
  }, [client, conflict, options.queryKey])
  if (trace.error) return null
  const first = trace.data?.pages[0]
  if (trace.isPending)
    return (
      <p className="py-0.5 body-xs-regular text-text-tertiary">
        {t(($) => $['external.overview.testRun.waitingResult'])}
      </p>
    )
  if (!first) return null
  const steps = trace.data?.pages.flatMap((page) => page.steps) ?? []
  const keys = new Set(steps.map((step) => step.key))
  const children = new Map<string, ExternalTraceStepResponse[]>()
  for (const step of steps) {
    const parent =
      step.resolved_parent_key && keys.has(step.resolved_parent_key) ? step.resolved_parent_key : ''
    const group = children.get(parent) ?? []
    group.push(step)
    children.set(parent, group)
  }
  const renderSteps = (parent: string, visited: ReadonlySet<string>): React.ReactNode => {
    const group = children.get(parent)
    if (!group?.length) return null
    return (
      <ul className={cn('space-y-1', parent && 'ms-3 border-s border-divider-subtle ps-2')}>
        {group
          .filter((step) => !visited.has(step.key))
          .map((step) => (
            <TraceStep key={step.key} invocationId={invocationId} step={step}>
              {renderSteps(step.key, new Set([...visited, step.key]))}
            </TraceStep>
          ))}
      </ul>
    )
  }
  const emptyMessage =
    first.state === 'not_requested'
      ? t(($) => $['external.overview.testRun.tracingOff'])
      : first.state === 'empty'
        ? t(($) => $['external.overview.testRun.traceEmpty'])
        : first.state === 'not_returned'
          ? t(($) => $['external.overview.testRun.traceNotReturned'])
          : first.state === 'unavailable'
            ? t(($) => $['external.overview.testRun.traceUnavailable'])
            : t(($) => $['external.overview.testRun.noTrace'])
  return (
    <div className="space-y-2">
      {steps.length ? (
        <>
          <p className="py-0.5 body-xs-regular text-text-tertiary">
            {t(($) => $['external.overview.testRun.stepsReceived'], {
              count: first.received_steps,
            })}
          </p>
          {renderSteps('', new Set())}
        </>
      ) : (
        <p className="py-0.5 body-xs-regular text-text-tertiary">{emptyMessage}</p>
      )}
      {first.diagnostics.map((diagnostic) => (
        <p key={diagnostic} className="body-xs-regular wrap-anywhere text-text-tertiary">
          {diagnostic}
        </p>
      ))}
      {trace.hasNextPage && (
        <Button
          size="small"
          loading={trace.isFetchingNextPage}
          onClick={() => {
            void trace.fetchNextPage()
          }}
        >
          {t(($) => $['common.loadMore'], { ns: 'workflow' })}
        </Button>
      )}
    </div>
  )
}

export function ExternalAgentInvocationTrace({
  invocationId,
  enabled,
}: {
  invocationId: string | undefined
  enabled: boolean
}) {
  return invocationId && enabled ? (
    <TraceSession key={invocationId} invocationId={invocationId} />
  ) : null
}

export function ExternalAgentInvocationTraceDetails({ invocationId }: { invocationId: string }) {
  const { t } = useTranslation(['agentRoster'])
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-divider-subtle p-2"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-md px-1 py-1 text-start system-sm-medium text-text-secondary">
        <span
          aria-hidden
          className="i-ri-arrow-right-s-line size-4 group-data-panel-open:rotate-90 rtl:-scale-x-100"
        />
        {t(($) => $['external.overview.tracing'])}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        {open && (
          <div className="pt-2">
            <ExternalAgentInvocationTrace invocationId={invocationId} enabled />
          </div>
        )}
      </CollapsiblePanel>
    </Collapsible>
  )
}
