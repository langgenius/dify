'use client'

import type { EvaluationResourceProps } from '../types'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useEvaluationResource, useEvaluationStore } from '../store'
import ConditionGroup from './condition-group'
import SectionHeader from './section-header'

const ConditionsSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const addConditionGroup = useEvaluationStore(state => state.addConditionGroup)

  return (
    <section className="rounded-2xl border border-divider-subtle bg-components-card-bg p-5">
      <SectionHeader
        title={t('conditions.title')}
        description={t('conditions.description')}
        action={(
          <Button variant="secondary" onClick={() => addConditionGroup(resourceType, resourceId)}>
            <span aria-hidden="true" className="i-ri-add-line mr-1 h-4 w-4" />
            {t('conditions.addGroup')}
          </Button>
        )}
      />
      <div className="mt-4 space-y-4">
        {resource.conditions.length === 0 && (
          <div className="rounded-2xl border border-dashed border-divider-subtle px-4 py-10 text-center">
            <div className="text-text-primary system-sm-semibold">{t('conditions.emptyTitle')}</div>
            <div className="mt-1 text-text-tertiary system-sm-regular">{t('conditions.emptyDescription')}</div>
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
      </div>
    </section>
  )
}

export default ConditionsSection
