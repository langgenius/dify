'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { setStepAtom } from '../../state/workflow-atoms'
import {
  useReleaseNextAction,
  useReleaseNextDisabled,
} from './actions.data'

export function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const setStep = useSetAtom(setStepAtom)
  const nextDisabled = useReleaseNextDisabled()
  const handleNext = useReleaseNextAction()

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setStep('source')}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="primary" disabled={nextDisabled} onClick={handleNext}>
        {t('createGuide.actions.next')}
      </Button>
    </>
  )
}
