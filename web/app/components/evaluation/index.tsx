'use client'

import type { EvaluationResourceProps } from './types'
import { useEffect } from 'react'
import { useEvaluationConfig } from '@/service/use-evaluation'
import NonPipelineEvaluation from './components/layout/non-pipeline-evaluation'
import PipelineEvaluation from './components/layout/pipeline-evaluation'
import { useEvaluationStore } from './store'

const Evaluation = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { data: config } = useEvaluationConfig(resourceType, resourceId)
  const ensureResource = useEvaluationStore(state => state.ensureResource)
  const hydrateResource = useEvaluationStore(state => state.hydrateResource)

  useEffect(() => {
    ensureResource(resourceType, resourceId)
  }, [ensureResource, resourceId, resourceType])

  useEffect(() => {
    if (!config)
      return

    hydrateResource(resourceType, resourceId, config)
  }, [config, hydrateResource, resourceId, resourceType])

  if (resourceType === 'datasets') {
    return (
      <PipelineEvaluation
        resourceType={resourceType}
        resourceId={resourceId}
      />
    )
  }

  return (
    <NonPipelineEvaluation
      resourceType={resourceType}
      resourceId={resourceId}
    />
  )
}

export default Evaluation
