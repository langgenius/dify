'use client'

import type { EvaluationResourceProps } from './types'
import { useEffect } from 'react'
import NonPipelineEvaluation from './components/non-pipeline-evaluation'
import PipelineEvaluation from './components/pipeline-evaluation'
import { useEvaluationStore } from './store'

const Evaluation = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const ensureResource = useEvaluationStore(state => state.ensureResource)

  useEffect(() => {
    ensureResource(resourceType, resourceId)
  }, [ensureResource, resourceId, resourceType])

  if (resourceType === 'pipeline') {
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
