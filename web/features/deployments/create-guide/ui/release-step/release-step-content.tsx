'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  continueFromReleaseAtom,
  releaseCanGoNextAtom,
  stepAtom,
} from '@/features/deployments/create-guide/state'
import { StepShell } from '../layout'
import {
  DeploymentInfoSection,
  InitialReleaseSection,
} from './fields'

export function ReleaseStepContent() {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.release.title')}
      description={t('createGuide.release.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <DeploymentInfoSection />
        <InitialReleaseSection />
      </div>
    </StepShell>
  )
}

export function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const canGoNext = useAtomValue(releaseCanGoNextAtom)
  const setStep = useSetAtom(stepAtom)
  const continueFromRelease = useSetAtom(continueFromReleaseAtom)

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setStep('source')}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="primary" disabled={!canGoNext} onClick={continueFromRelease}>
        {t('createGuide.actions.next')}
      </Button>
    </>
  )
}
