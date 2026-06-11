'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import {
  useSourceCanEnterReleaseStep,
  useSourceNextAction,
} from './actions.data'

export function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const canEnterReleaseStep = useSourceCanEnterReleaseStep()
  const handleNext = useSourceNextAction(canEnterReleaseStep)

  return (
    <Button type="button" variant="primary" disabled={!canEnterReleaseStep} onClick={handleNext}>
      {t('createGuide.actions.next')}
    </Button>
  )
}
