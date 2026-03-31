'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import { useEvaluationStore } from '../../store'
import CustomMetricEditorCard from '../custom-metric-editor-card'

type MetricCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
  nodesLabel: string
  nodesAllLabel: string
  removeLabel: string
}

const MetricCard = ({
  resourceType,
  resourceId,
  metric,
  nodesLabel,
  nodesAllLabel,
  removeLabel,
}: MetricCardProps) => {
  const removeMetric = useEvaluationStore(state => state.removeMetric)

  return (
    <div className="rounded-2xl border border-divider-subtle bg-components-card-bg p-4">
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
              <div className="text-text-secondary system-2xs-medium-uppercase">{nodesLabel}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {metric.nodeInfoList?.length
                  ? metric.nodeInfoList.map(nodeInfo => (
                      <Badge key={nodeInfo.node_id} className="badge-accent">
                        {nodeInfo.title}
                      </Badge>
                    ))
                  : (
                      <span className="text-text-tertiary system-xs-regular">{nodesAllLabel}</span>
                    )}
              </div>
            </div>
          )}
        </div>
        <Button
          size="small"
          variant="ghost"
          aria-label={removeLabel}
          onClick={() => removeMetric(resourceType, resourceId, metric.id)}
        >
          <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
        </Button>
      </div>
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
