'use client'

import type { EvaluationResourceProps } from './types'
import { useEffect } from 'react'
import EvaluationLayout from './components/layout/evaluation-layout'
import EvaluationNodeNameNotice from './evaluation-node-name-notice'
import EvaluationTargetWorkflowGuard from './evaluation-target-workflow-guard'
import { useEvaluationConfigQuery } from './queries'
import { useEvaluationStore } from './store'

const EvaluationContent = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { data: config } = useEvaluationConfigQuery({ resourceType, resourceId })
  const ensureResource = useEvaluationStore((state) => state.ensureResource)
  const hydrateResource = useEvaluationStore((state) => state.hydrateResource)

  useEffect(() => {
    ensureResource(resourceType, resourceId)
  }, [ensureResource, resourceId, resourceType])

  useEffect(() => {
    if (!config) return

    hydrateResource(resourceType, resourceId, config)
  }, [config, hydrateResource, resourceId, resourceType])

  return <EvaluationLayout resourceType={resourceType} resourceId={resourceId} />
}

const Evaluation = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  if (resourceType === 'apps' || resourceType === 'snippets') {
    return (
      <EvaluationTargetWorkflowGuard
        key={`${resourceType}:${resourceId}`}
        resourceType={resourceType}
        resourceId={resourceId}
      >
        <EvaluationNodeNameNotice resourceType={resourceType} resourceId={resourceId}>
          <EvaluationContent resourceType={resourceType} resourceId={resourceId} />
        </EvaluationNodeNameNotice>
      </EvaluationTargetWorkflowGuard>
    )
  }

  return <EvaluationContent resourceType={resourceType} resourceId={resourceId} />
}

export default Evaluation
