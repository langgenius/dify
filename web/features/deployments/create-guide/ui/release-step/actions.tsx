'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  releaseCanGoNextAtom,
} from '../../state/guide-derived-atoms'
import { resetDeploymentTargetOptionsAtom } from '../../state/target-atoms'
import {
  setStepAtom,
} from '../../state/workflow-atoms'

export function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const canGoNext = useAtomValue(releaseCanGoNextAtom)
  const setStep = useSetAtom(setStepAtom)
  const resetTargetOptions = useSetAtom(resetDeploymentTargetOptionsAtom)

  function handleNext() {
    if (!canGoNext)
      return

    resetTargetOptions()
    setStep('target')
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setStep('source')}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
        {t('createGuide.actions.next')}
      </Button>
    </>
  )
}
