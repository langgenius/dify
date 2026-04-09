'use client'

import type { EvaluationResourceProps } from '../../types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import { buildConditionMetricOptions } from '../../utils'
import { InlineSectionHeader } from '../section-header'
import ConditionGroup from './condition-group'

const ConditionsSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const addCondition = useEvaluationStore(state => state.addCondition)
  const conditionMetricOptions = useMemo(() => buildConditionMetricOptions(resource.metrics), [resource.metrics])
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
        <button
          type="button"
          className={cn(
            'inline-flex items-center system-sm-medium text-text-accent',
            !canAddCondition && 'cursor-not-allowed text-components-button-secondary-accent-text-disabled',
          )}
          disabled={!canAddCondition}
          onClick={() => addCondition(resourceType, resourceId)}
        >
          <span aria-hidden="true" className="mr-1 i-ri-add-line h-4 w-4" />
          {t('conditions.addCondition')}
        </button>
      </div>
    </section>
  )
}

export default ConditionsSection
