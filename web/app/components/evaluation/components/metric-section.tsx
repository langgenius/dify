'use client'

import type { EvaluationResourceProps } from '../types'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import { useEvaluationResource, useEvaluationStore } from '../store'
import CustomMetricEditor from './custom-metric-editor'
import MetricSelector from './metric-selector'
import SectionHeader from './section-header'

const MetricSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const removeMetric = useEvaluationStore(state => state.removeMetric)

  return (
    <section className="rounded-2xl border border-divider-subtle bg-components-card-bg p-5">
      <SectionHeader
        title={t('metrics.title')}
        description={t('metrics.description')}
        action={<MetricSelector resourceType={resourceType} resourceId={resourceId} />}
      />
      <div className="mt-4 space-y-3">
        {resource.metrics.map(metric => (
          <div key={metric.id} className="rounded-2xl border border-divider-subtle p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-text-primary system-sm-semibold">{metric.label}</div>
                <div className="mt-1 text-text-tertiary system-xs-regular">{metric.description}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {metric.badges.map(badge => (
                    <Badge key={badge} className={badge === 'Workflow' ? 'badge-accent' : ''}>{badge}</Badge>
                  ))}
                </div>
              </div>
              <Button
                size="small"
                variant="ghost"
                aria-label={t('metrics.remove')}
                onClick={() => removeMetric(resourceType, resourceId, metric.id)}
              >
                <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
              </Button>
            </div>
            {metric.kind === 'custom-workflow' && (
              <CustomMetricEditor
                resourceType={resourceType}
                resourceId={resourceId}
                metric={metric}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export default MetricSection
