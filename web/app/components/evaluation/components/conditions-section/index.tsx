'use client'

import type { EvaluationResourceProps } from '../../types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useEvaluationResource } from '../../store'
import { buildConditionMetricOptions, groupConditionMetricOptions } from '../../utils'
import { InlineSectionHeader } from '../section-header'
import AddConditionSelect from './add-condition-select'
import ConditionGroup from './condition-group'

const ConditionsSection = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { t } = useTranslation(['evaluation'])
  const resource = useEvaluationResource(resourceType, resourceId)
  const conditionMetricOptions = useMemo(
    () => buildConditionMetricOptions(resource.metrics, resourceType, resourceId),
    [resource.metrics, resourceType, resourceId],
  )
  const groupedConditionMetricOptions = useMemo(
    () => groupConditionMetricOptions(conditionMetricOptions),
    [conditionMetricOptions],
  )
  const canAddCondition = conditionMetricOptions.length > 0
  let emptyMessage: string = t(($) => $['conditions.emptyTitle'])
  if (!canAddCondition) {
    emptyMessage =
      resourceType === 'datasets'
        ? t(($) => $['conditions.selectFieldFirst'])
        : t(($) => $['conditions.emptyDescription'])
  }

  return (
    <section className="py-4 xl:max-w-[700px]">
      <InlineSectionHeader
        title={t(($) => $['conditions.title'])}
        tooltip={resourceType === 'datasets' ? undefined : t(($) => $['conditions.description'])}
      />
      <div className="mt-2 space-y-4">
        {resource.judgmentConfig.conditions.length === 0 && (
          <div className="rounded-xl bg-background-section px-3 py-3 system-xs-regular text-text-tertiary">
            {emptyMessage}
          </div>
        )}
        {resource.judgmentConfig.conditions.length > 0 && (
          <ConditionGroup resourceType={resourceType} resourceId={resourceId} />
        )}
        {/* Own wrapper: an open popup inserts focus guards beside its trigger, which would shift space-y margins. */}
        <div>
          <AddConditionSelect
            resourceType={resourceType}
            resourceId={resourceId}
            metricOptionGroups={groupedConditionMetricOptions}
            disabled={!canAddCondition}
          />
        </div>
      </div>
    </section>
  )
}

export default ConditionsSection
