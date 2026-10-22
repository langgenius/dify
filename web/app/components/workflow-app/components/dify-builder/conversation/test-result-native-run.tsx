import type { NodeTracing } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/console'
import { useDifyBuilderInteractionLocale } from '../interactions/use-interaction-locale'
import { TestResultOutputs } from './test-result-outputs'

const TracingPanel = dynamic(() => import('@/app/components/workflow/run/tracing-panel'))

type NativeRunProps = { appId: string; runId: string }

const RunLoading = () => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  return (
    <SkeletonContainer role="status" aria-label={t(($) => $.loading, { ns: 'common' })}>
      <SkeletonRectangle aria-hidden className="h-4 w-full" />
      <SkeletonRectangle aria-hidden className="h-4 w-3/4" />
    </SkeletonContainer>
  )
}

const RunLoadError = ({ retry }: { retry: () => void }) => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert">{t(($) => $['testResult.resultLoadFailed'], { ns: 'difyBuilder' })}</p>
      <Button size="small" variant="secondary" onClick={retry}>
        {t(($) => $['operation.retry'], { ns: 'common' })}
      </Button>
    </div>
  )
}

export const TestResultNativeOutputs = ({
  appId,
  runId,
  failureReason,
}: NativeRunProps & { failureReason?: string | null }) => {
  // Native content is read for this card's run only. It never enters Builder's
  // persisted conversation, session projection, or model context.
  const { data, isPending, isError, refetch } = useQuery(
    consoleQuery.apps.byAppId.workflowRuns.byRunId.get.queryOptions({
      input: { params: { app_id: appId, run_id: runId } },
      context: { silent: true },
    }),
  )
  if (isPending) return <RunLoading />
  if (isError) return <RunLoadError retry={() => void refetch()} />
  return (
    <>
      {data.error && data.error !== failureReason && (
        <p className="wrap-anywhere whitespace-pre-wrap text-text-destructive">{data.error}</p>
      )}
      <TestResultOutputs outputs={data.outputs} />
    </>
  )
}

const NativeRunTracing = ({ appId, runId }: NativeRunProps) => {
  const { data, isPending, isError, refetch } = useQuery(
    consoleQuery.apps.byAppId.workflowRuns.byRunId.nodeExecutions.get.queryOptions({
      input: { params: { app_id: appId, run_id: runId } },
      context: { silent: true },
    }),
  )
  if (isPending) return <RunLoading />
  if (isError) return <RunLoadError retry={() => void refetch()} />
  return <TracingPanel list={data.data as NodeTracing[]} />
}

export const TestResultRunDetails = ({ appId, runId }: NativeRunProps) => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  return (
    <Collapsible className="rounded-lg border border-components-panel-border bg-components-panel-bg p-1">
      <CollapsibleTrigger className="group/run-details flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-start system-sm-medium text-text-secondary hover:bg-components-panel-on-panel-item-bg-hover data-panel-open:text-text-primary">
        <span>{t(($) => $['testResult.runDetails'], { ns: 'difyBuilder' })}</span>
        <span
          aria-hidden
          className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary transition-transform duration-150 group-data-panel-open/run-details:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="px-2.5 pt-1 pb-2">
          <Suspense fallback={<RunLoading />}>
            <NativeRunTracing appId={appId} runId={runId} />
          </Suspense>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  )
}
