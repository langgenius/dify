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
      <div className="mt-1 space-y-1">
        {!hasMetrics && <MetricSectionEmptyState description={t('metrics.description')} />}
        {resource.metrics.map(metric => (
          <MetricCard
            key={metric.id}
            resourceType={resourceType}
            resourceId={resourceId}
            metric={metric}
            nodesAllLabel={t('metrics.nodesAll')}
            removeLabel={t('metrics.remove')}
            customWarningLabel={t('metrics.custom.warningBadge')}
          />
        ))}
        <MetricSelector
          resourceType={resourceType}
          resourceId={resourceId}
          triggerClassName="rounded-md px-3 py-2"
        />
      </div>
    </section>
  )
}

export default MetricSection
