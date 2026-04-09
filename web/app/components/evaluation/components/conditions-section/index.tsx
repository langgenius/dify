'use client'

import type { EvaluationResourceProps } from '../../types'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import { InlineSectionHeader } from '../section-header'
import ConditionGroup from './condition-group'

const ConditionsSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const addConditionGroup = useEvaluationStore(state => state.addConditionGroup)
  const canAddCondition = resource.metrics.length > 0

  return (
    <section className="max-w-[700px] py-4">
      <InlineSectionHeader
        title={t('conditions.title')}
        tooltip={t('conditions.description')}
      />
      <div className="mt-2 space-y-4">
        {resource.conditions.length === 0 && (
          <div className="rounded-xl bg-background-section px-3 py-3 system-xs-regular text-text-tertiary">
            {t('conditions.emptyDescription')}
          </div>
        )}
        {resource.conditions.map((group, index) => (
          <ConditionGroup
            key={group.id}
            resourceType={resourceType}
            resourceId={resourceId}
            group={group}
            index={index}
          />
        ))}
        <button
          type="button"
          className={cn(
            'inline-flex items-center system-sm-medium text-text-accent',
            !canAddCondition && 'cursor-not-allowed text-components-button-secondary-accent-text-disabled',
          )}
          disabled={!canAddCondition}
          onClick={() => addConditionGroup(resourceType, resourceId)}
        >
          <span aria-hidden="true" className="mr-1 i-ri-add-line h-4 w-4" />
          {t('conditions.addCondition')}
        </button>
      </div>
    </section>
  )
}

export default ConditionsSection
