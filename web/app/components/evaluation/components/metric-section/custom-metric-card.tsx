'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { Button } from '@/app/components/base/ui/button'
import { isCustomMetricConfigured, useEvaluationStore } from '../../store'
import CustomMetricEditorCard from '../custom-metric-editor'
import { getToneClasses } from '../metric-selector/utils'

type CustomMetricCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
}

const CustomMetricCard = ({
  resourceType,
  resourceId,
  metric,
}: CustomMetricCardProps) => {
  const { t } = useTranslation('evaluation')
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const isCustomMetricInvalid = !isCustomMetricConfigured(metric)
  const metricToneClasses = getToneClasses('indigo')

  return (
    <div className="group overflow-hidden rounded-xl border border-components-panel-border hover:bg-background-section">
      <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <div className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]', metricToneClasses.soft)}>
            <span aria-hidden="true" className="i-ri-equalizer-2-line h-3.5 w-3.5" />
          </div>
          <div className="system-md-medium truncate text-text-secondary">{metric.label}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isCustomMetricInvalid && (
            <Badge className="badge-warning">
              {t('metrics.custom.warningBadge')}
            </Badge>
          )}
          <Button
            size="small"
            variant="ghost"
            aria-label={t('metrics.remove')}
            className="h-6 w-6 shrink-0 rounded-md p-0 text-text-quaternary opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-secondary focus-visible:opacity-100"
            onClick={() => removeMetric(resourceType, resourceId, metric.id)}
          >
            <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
          </Button>
        </div>
      </div>

      <CustomMetricEditorCard
        resourceType={resourceType}
        resourceId={resourceId}
        metric={metric}
      />
    </div>
  )
}

export default CustomMetricCard
