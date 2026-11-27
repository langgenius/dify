'use client'

import type { ReactNode } from 'react'
import type { Node } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { isTriggerWorkflow } from '@/app/components/workflow/utils/workflow-entry'
import { snippetPublishedWorkflowQueryOptions } from '@/service/snippet-queries'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'

type EvaluationTargetWorkflowGuardProps = {
  resourceType: 'apps' | 'snippets'
  resourceId: string
  children: ReactNode
}

/** Check the published target before mounting Evaluation's configuration and run controls. */
const EvaluationTargetWorkflowGuard = ({
  resourceType,
  resourceId,
  children,
}: EvaluationTargetWorkflowGuardProps) => {
  const { t } = useTranslation(['evaluation', 'common'])
  const appWorkflow = useQuery({
    ...appWorkflowQueryOptions(resourceType === 'apps' ? resourceId : undefined),
    refetchOnMount: 'always',
    retry: false,
  })
  const snippetWorkflow = useQuery({
    ...snippetPublishedWorkflowQueryOptions(resourceType === 'snippets' ? resourceId : ''),
    refetchOnMount: 'always',
    retry: false,
  })
  const workflowQuery = resourceType === 'apps' ? appWorkflow : snippetWorkflow
  const workflow = workflowQuery.data

  if (!workflowQuery.isFetchedAfterMount && !workflowQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center bg-background-default">
        <LoadingPlaceholder />
      </div>
    )
  }

  if (workflowQuery.isError || !workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background-default px-6 text-center">
        <p role="alert" className="system-sm-regular text-text-secondary">
          {t(($) => $['entry.checkFailed'])}
        </p>
        <Button variant="secondary" onClick={() => void workflowQuery.refetch()}>
          {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
        </Button>
      </div>
    )
  }

  const nodes = workflow.graph.nodes
  if (Array.isArray(nodes) && isTriggerWorkflow(nodes as Node[])) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background-default px-6 text-center">
        <h1 className="system-xl-semibold text-text-primary">{t(($) => $.title)}</h1>
        <p role="status" className="max-w-lg system-sm-regular text-text-secondary">
          {t(($) => $['entry.triggerUnsupported'])}
        </p>
      </div>
    )
  }

  return children
}

export default EvaluationTargetWorkflowGuard
