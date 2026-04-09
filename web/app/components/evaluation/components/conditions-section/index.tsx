'use client'

import type { EvaluationResourceProps } from '../../types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useEvaluationResource } from '../../store'
import { buildConditionMetricOptions, groupConditionMetricOptions } from '../../utils'
import { InlineSectionHeader } from '../section-header'
import AddConditionSelect from './add-condition-select'
import ConditionGroup from './condition-group'

const ConditionsSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const conditionMetricOptions = useMemo(() => buildConditionMetricOptions(resource.metrics), [resource.metrics])
  const groupedConditionMetricOptions = useMemo(() => groupConditionMetricOptions(conditionMetricOptions), [conditionMetricOptions])
  const canAddCondition = conditionMetricOptions.length > 0

  return (
    <section className="max-w-[700px] py-4">
      <InlineSectionHeader
        title={t('conditions.title')}
        tooltip={t('conditions.description')}
      />
      <div className="mt-2 space-y-4">
        {resource.judgmentConfig.conditions.length === 0 && (
          <div className="rounded-xl bg-background-section px-3 py-3 system-xs-regular text-text-tertiary">
            {t('conditions.emptyDescription')}
          </div>
        )}
        {resource.judgmentConfig.conditions.length > 0 && (
          <ConditionGroup
            resourceType={resourceType}
            resourceId={resourceId}
          />
        )}
        <AddConditionSelect
          resourceType={resourceType}
          resourceId={resourceId}
          metricOptionGroups={groupedConditionMetricOptions}
          disabled={!canAddCondition}
        />
      </div>
    </section>
  )
}

export default ConditionsSection
