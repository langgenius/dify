'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useReleaseAction } from './actions.data'

export function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const {
    canGoNext,
    handleBack,
    handleNext,
  } = useReleaseAction()

  return (
    <>
      <Button type="button" variant="secondary" onClick={handleBack}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
        {t('createGuide.actions.next')}
      </Button>
    </>
  )
}
