'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { setStepAtom } from '../../state/workflow-atoms'
import {
  useReleaseCanEnterTargetStep,
  useReleaseNextAction,
} from './actions.data'

export function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const setStep = useSetAtom(setStepAtom)
  const canEnterTargetStep = useReleaseCanEnterTargetStep()
  const handleNext = useReleaseNextAction(canEnterTargetStep)

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setStep('source')}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="primary" disabled={!canEnterTargetStep} onClick={handleNext}>
        {t('createGuide.actions.next')}
      </Button>
    </>
  )
}
