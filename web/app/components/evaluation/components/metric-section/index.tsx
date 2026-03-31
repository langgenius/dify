'use client'

import type { EvaluationResourceProps } from '../../types'
import { useTranslation } from 'react-i18next'
import { useEvaluationResource } from '../../store'
import MetricSelector from '../metric-selector'
import { InlineSectionHeader } from '../section-header'
import MetricCard from './metric-card'
import MetricSectionEmptyState from './metric-section-empty-state'

const MetricSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const hasMetrics = resource.metrics.length > 0

  return (
    <section className="max-w-[700px] py-4">
      <InlineSectionHeader
        title={t('metrics.title')}
        tooltip={t('metrics.description')}
      />
      <div className="mt-2 space-y-3">
        {!hasMetrics && <MetricSectionEmptyState description={t('metrics.description')} />}
        {resource.metrics.map(metric => (
          <MetricCard
            key={metric.id}
            resourceType={resourceType}
            resourceId={resourceId}
            metric={metric}
            nodesLabel={t('metrics.nodesLabel')}
            nodesAllLabel={t('metrics.nodesAll')}
            removeLabel={t('metrics.remove')}
          />
        ))}
        <MetricSelector
          resourceType={resourceType}
          resourceId={resourceId}
        />
      </div>
    </section>
  )
}

export default MetricSection
