'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  continueFromReleaseAtom,
  releaseCanGoNextAtom,
  stepAtom,
} from '@/features/deployments/create-guide/state'

export function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const canGoNext = useAtomValue(releaseCanGoNextAtom)
  const setStep = useSetAtom(stepAtom)
  const continueFromRelease = useSetAtom(continueFromReleaseAtom)

  function handleNext() {
    continueFromRelease()
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
