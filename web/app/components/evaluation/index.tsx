'use client'

import type { EvaluationResourceProps } from './types'
import { useEffect } from 'react'
import EvaluationLayout from './components/layout/evaluation-layout'
import { useEvaluationConfigQuery } from './queries'
import { useEvaluationStore } from './store'

const Evaluation = ({ resourceType, resourceId }: EvaluationResourceProps) => {
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

export default Evaluation
