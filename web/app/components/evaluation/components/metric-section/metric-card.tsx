'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'
import { isCustomMetricConfigured, useEvaluationStore } from '../../store'
import CustomMetricEditorCard from '../custom-metric-editor-card'
import { getMetricVisual, getNodeVisual, getToneClasses } from '../metric-selector/utils'

type MetricCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
  nodesAllLabel: string
  removeLabel: string
  customWarningLabel: string
}

const MetricCard = ({
  resourceType,
  resourceId,
  metric,
  nodesAllLabel,
  removeLabel,
  customWarningLabel,
}: MetricCardProps) => {
  const updateBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const metricVisual = metric.kind === 'custom-workflow'
    ? { icon: 'i-ri-equalizer-2-line', tone: 'indigo' as const }
    : getMetricVisual(metric.optionId)
  const metricToneClasses = getToneClasses(metricVisual.tone)
  const isCustomMetricInvalid = metric.kind === 'custom-workflow' && !isCustomMetricConfigured(metric)
  const hasSelectedNodes = metric.kind === 'builtin' && !!metric.nodeInfoList?.length

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-components-panel-border',
        hasSelectedNodes ? 'bg-background-section' : 'bg-components-card-bg',
      )}
    >
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <div className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]', metricToneClasses.soft)}>
            <span aria-hidden="true" className={cn(metricVisual.icon, 'h-3.5 w-3.5')} />
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <div className="truncate text-text-secondary system-md-medium">{metric.label}</div>
            {metric.description && (
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <button
                      type="button"
                      className="flex h-4 w-4 shrink-0 items-center justify-center text-text-quaternary transition-colors hover:text-text-tertiary"
                      aria-label={metric.label}
                    >
                      <span aria-hidden="true" className="i-ri-question-line h-3.5 w-3.5" />
                    </button>
                  )}
                />
                <TooltipContent>
                  {metric.description}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isCustomMetricInvalid && (
            <Badge className="badge-warning">
              {customWarningLabel}
            </Badge>
          )}
          <Button
            size="small"
            variant="ghost"
            aria-label={removeLabel}
            onClick={() => removeMetric(resourceType, resourceId, metric.id)}
          >
            <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
          </Button>
        </div>
      </div>

      {metric.kind === 'builtin' && (
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
                <span className="px-1 text-text-tertiary system-xs-regular">{nodesAllLabel}</span>
              )}
        </div>
      )}

      {metric.kind === 'custom-workflow' && (
        <CustomMetricEditorCard
          resourceType={resourceType}
          resourceId={resourceId}
          metric={metric}
        />
      )}
    </div>
  )
}

export default MetricCard
