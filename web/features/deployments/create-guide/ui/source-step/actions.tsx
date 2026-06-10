'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useSourceAction } from './actions.data'

export function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const {
    canGoNext,
    handleNext,
  } = useSourceAction()

  return (
    <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
      {t('createGuide.actions.next')}
    </Button>
  )
}
