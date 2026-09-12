import type { WorkflowRunInfo } from './workflow-tool-tracing-context'
import type { NodeTracing } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { noop, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/console'
import TracingPanel from './tracing-panel'

export default function WorkflowToolTracing({
  node,
  workflowRun,
  onBack,
}: {
  node: NodeTracing
  workflowRun: WorkflowRunInfo
  onBack: () => void
}) {
  const { t } = useTranslation()
  const isActive = workflowRun.status === 'running' || workflowRun.status === 'paused'
  const { data, isPending, isError, refetch } = useQuery(
    consoleQuery.apps.byAppId.workflowRuns.byRunId.nodeExecutions.byNodeExecutionId.children.get.queryOptions(
      {
        input: {
          params: {
            app_id: workflowRun.appId,
            run_id: workflowRun.runId,
            node_execution_id:
              'node_execution_id' in node && typeof node.node_execution_id === 'string'
                ? node.node_execution_id
                : node.id,
          },
        },
        refetchInterval: isActive ? 2000 : false,
      },
    ),
  )

  // Refresh the persisted child executions when the live run finishes.
  useEffect(() => {
    if (!isActive) refetch().catch(noop)
  }, [isActive, refetch])

  return (
    <div className="bg-background-section-burn">
      <Button variant="ghost" className="w-full justify-start" onClick={onBack}>
        <span aria-hidden className="i-ri-arrow-left-line size-4" />
        {t(($) => $['singleRun.back'], { ns: 'workflow' })}
      </Button>
      <div className="px-4 py-2 system-sm-semibold text-text-primary">{node.title}</div>
      {isPending && (
        <SkeletonContainer
          role="status"
          aria-label={t(($) => $.loading, { ns: 'common' })}
          className="px-4"
        >
          <SkeletonRectangle className="h-10" />
          <SkeletonRectangle className="h-10" />
        </SkeletonContainer>
      )}
      {isError && (
        <div role="alert" className="space-y-2 px-4 py-2 text-text-destructive">
          <div>{t(($) => $['api.actionFailed'], { ns: 'common' })}</div>
          <Button onClick={() => refetch().catch(noop)}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {data && !data.data.length && (
        <div className="px-4 py-2 text-text-tertiary">{t(($) => $.noData, { ns: 'common' })}</div>
      )}
      {/* The legacy renderer also types optional live-event fields as required. */}
      {data && <TracingPanel list={data.data as unknown as NodeTracing[]} />}
    </div>
  )
}
