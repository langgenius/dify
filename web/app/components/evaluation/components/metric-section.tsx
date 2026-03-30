'use client'

import type { EvaluationResourceProps } from '../types'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import { useEvaluationResource, useEvaluationStore } from '../store'
import CustomMetricEditor from './custom-metric-editor'
import MetricSelector from './metric-selector'
import { InlineSectionHeader } from './section-header'

const MetricSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const hasMetrics = resource.metrics.length > 0

  return (
    <section className="max-w-[700px] py-4">
      <InlineSectionHeader
        title={t('metrics.title')}
        tooltip={t('metrics.description')}
      />
      <div className="mt-2 space-y-3">
        {!hasMetrics && (
          <div className="flex items-center gap-5 rounded-xl bg-background-section px-3 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-md">
              <span aria-hidden="true" className="i-ri-bar-chart-horizontal-line h-6 w-6 text-text-primary" />
            </div>
            <div className="text-text-tertiary system-xs-regular">
              {t('metrics.description')}
            </div>
          </div>
        )}
        {resource.metrics.map(metric => (
          <div key={metric.id} className="rounded-2xl border border-divider-subtle bg-components-card-bg p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-text-primary system-sm-semibold">{metric.label}</div>
                <div className="mt-1 text-text-tertiary system-xs-regular">{metric.description}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {metric.badges.map(badge => (
                    <Badge key={badge} className={badge === 'Workflow' ? 'badge-accent' : ''}>{badge}</Badge>
                  ))}
                </div>
                {metric.kind === 'builtin' && (
                  <div className="mt-3 rounded-xl bg-background-default-subtle px-3 py-2">
                    <div className="text-text-secondary system-2xs-medium-uppercase">{t('metrics.nodesLabel')}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {metric.nodeInfoList?.length
                        ? metric.nodeInfoList.map(nodeInfo => (
                            <Badge key={nodeInfo.node_id} className="badge-accent">
                              {nodeInfo.title}
                            </Badge>
                          ))
                        : (
                            <span className="text-text-tertiary system-xs-regular">{t('metrics.nodesAll')}</span>
                          )}
                    </div>
                  </div>
                )}
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
        <MetricSelector
          resourceType={resourceType}
          resourceId={resourceId}
        />
      </div>
    </section>
  )
}

export default MetricSection
