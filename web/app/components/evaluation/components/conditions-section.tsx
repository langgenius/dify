'use client'

import type { EvaluationResourceProps } from '../types'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { useEvaluationResource, useEvaluationStore } from '../store'
import ConditionGroup from './condition-group'
import { InlineSectionHeader } from './section-header'

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
          <div className="rounded-xl bg-background-section px-3 py-3 text-text-tertiary system-xs-regular">
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
            'inline-flex items-center text-text-accent system-sm-medium',
            !canAddCondition && 'cursor-not-allowed text-components-button-secondary-accent-text-disabled',
          )}
          disabled={!canAddCondition}
          onClick={() => addConditionGroup(resourceType, resourceId)}
        >
          <span aria-hidden="true" className="i-ri-add-line mr-1 h-4 w-4" />
          {t('conditions.addCondition')}
        </button>
      </div>
    </section>
  )
}

export default ConditionsSection
