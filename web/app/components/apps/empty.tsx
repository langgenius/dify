import * as React from 'react'
import { useTranslation } from 'react-i18next'
import FilterEmptyState from '@/app/components/base/filter-empty-state'

type EmptyProps = {
  message?: string
  stepByStepTourTarget?: string
}

const Empty = ({ message, stepByStepTourTarget }: EmptyProps) => {
  const { t } = useTranslation()

  return (
    <FilterEmptyState
      title={message ?? t('filterEmpty.noApps', { ns: 'app' })}
      contentDataAttributes={stepByStepTourTarget ? { 'data-step-by-step-tour-target': stepByStepTourTarget } : undefined}
    />
  )
}

export default React.memo(Empty)
