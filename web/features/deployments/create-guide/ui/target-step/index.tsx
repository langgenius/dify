'use client'

import { useTranslation } from 'react-i18next'
import { StepShell } from '../shell/layout'
import { TargetBindingSection } from './binding-section'
import { TargetEnvVarSection } from './env-var-section'
import { TargetEnvironmentSection } from './environment-section'
import { TargetUnsupportedDslNodesSection } from './unsupported-dsl-nodes-section'

export function TargetStepContent() {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.target.title')}
      description={t('createGuide.target.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <TargetEnvironmentSection />
        <TargetUnsupportedDslNodesSection />
        <TargetBindingSection />
        <TargetEnvVarSection />
      </div>
    </StepShell>
  )
}
