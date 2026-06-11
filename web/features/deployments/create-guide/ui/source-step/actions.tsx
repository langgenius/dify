'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import {
  useSourceNextAction,
  useSourceNextDisabled,
} from './actions.data'

export function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const nextDisabled = useSourceNextDisabled()
  const handleNext = useSourceNextAction()

  return (
    <Button type="button" variant="primary" disabled={nextDisabled} onClick={handleNext}>
      {t('createGuide.actions.next')}
    </Button>
  )
}
