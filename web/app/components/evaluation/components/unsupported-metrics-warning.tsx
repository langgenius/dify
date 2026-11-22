'use client'

import type { EvaluationResourceProps } from '../types'
import { useTranslation } from 'react-i18next'
import { useEvaluationResource } from '../store'
import { getUnsupportedBuiltinMetrics } from '../store-utils'

const UnsupportedMetricsWarning = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { t } = useTranslation(['evaluation'])
  const resource = useEvaluationResource(resourceType, resourceId)
  const unsupportedMetrics = getUnsupportedBuiltinMetrics(resource)

  if (unsupportedMetrics.length === 0) return null

  return (
    <div
      role="alert"
      className="rounded-lg bg-background-section px-3 py-2 system-xs-regular text-text-warning"
    >
      {t(($) => $['metrics.unsupportedFramework'], {
        framework: resource.evaluationFramework === 'deepeval' ? 'DeepEval' : 'Ragas',
        metrics: unsupportedMetrics.map((metric) => metric.label).join(', '),
      })}
    </div>
  )
}

export default UnsupportedMetricsWarning
