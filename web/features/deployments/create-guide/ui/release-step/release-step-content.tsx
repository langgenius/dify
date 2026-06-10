'use client'

import { useTranslation } from 'react-i18next'
import { StepShell } from '../shell/layout'
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
