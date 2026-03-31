'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { cn } from '@/utils/classnames'
import { useEvaluationStore } from '../../store'
import { getMetricVisual, getNodeVisual, getToneClasses } from '../metric-selector/utils'

type BuiltinMetricCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
}

const BuiltinMetricCard = ({
  resourceType,
  resourceId,
  metric,
}: BuiltinMetricCardProps) => {
  const { t } = useTranslation('evaluation')
  const updateBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const [isExpanded, setIsExpanded] = useState(true)
  const metricVisual = getMetricVisual(metric.optionId)
  const metricToneClasses = getToneClasses(metricVisual.tone)

  return (
    <div className="group overflow-hidden rounded-xl border border-components-panel-border hover:bg-background-section">
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? t('metrics.collapseNodes') : t('metrics.expandNodes')}
          onClick={() => setIsExpanded(current => !current)}
        >
          <div className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]', metricToneClasses.soft)}>
            <span aria-hidden="true" className={cn(metricVisual.icon, 'h-3.5 w-3.5')} />
          </div>
          <div className="flex min-w-0 items-center gap-0.5">
            <div className="truncate text-text-secondary system-md-medium">{metric.label}</div>
            <span
              aria-hidden="true"
              className={cn('i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-quaternary transition-transform', !isExpanded && '-rotate-90')}
            />
          </div>
        </button>

        <Button
          size="small"
          variant="ghost"
          aria-label={t('metrics.remove')}
          className="h-6 w-6 shrink-0 rounded-md p-0 text-text-quaternary opacity-0 transition-opacity hover:text-text-secondary focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => removeMetric(resourceType, resourceId, metric.id)}
        >
          <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
        </Button>
      </div>

      {isExpanded && (
        <div className="flex flex-wrap gap-1 px-3 pb-3 pt-1">
          {metric.nodeInfoList?.length
            ? metric.nodeInfoList.map((nodeInfo) => {
                const nodeVisual = getNodeVisual(nodeInfo)
                const nodeToneClasses = getToneClasses(nodeVisual.tone)

                return (
                  <div
                    key={nodeInfo.node_id}
                    className="inline-flex min-w-[18px] items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark p-1.5 shadow-xs"
                  >
                    <div className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-[0.45px] border-divider-subtle shadow-xs shadow-shadow-shadow-3', nodeToneClasses.solid)}>
                      <span aria-hidden="true" className={cn(nodeVisual.icon, 'h-3.5 w-3.5')} />
                    </div>
                    <span className="px-1 text-text-primary system-xs-regular">{nodeInfo.title}</span>
                    <button
                      type="button"
                      className="flex h-4 w-4 items-center justify-center rounded-sm text-text-quaternary transition-colors hover:text-text-secondary"
                      aria-label={nodeInfo.title}
                      onClick={() => updateBuiltinMetric(
                        resourceType,
                        resourceId,
                        metric.optionId,
                        metric.nodeInfoList?.filter(item => item.node_id !== nodeInfo.node_id) ?? [],
                      )}
                    >
                      <span aria-hidden="true" className="i-ri-close-line h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })
            : (
                <span className="px-1 text-text-tertiary system-xs-regular">{t('metrics.nodesAll')}</span>
              )}
        </div>
      )}
    </div>
  )
}

export default BuiltinMetricCard
