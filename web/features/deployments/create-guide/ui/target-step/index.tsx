'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import { unsupportedDslNodesAtom } from '@/features/deployments/create-guide/state'
import { StepShell } from '../shell/layout'
import { TargetBindingSection } from './bindings/section'
import { TargetEnvVarSection } from './env-vars/section'
import { TargetEnvironmentSection } from './environment/section'

export function TargetStepContent() {
  const { t } = useTranslation('deployments')
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return (
    <StepShell
      title={t('createGuide.target.title')}
      description={t('createGuide.target.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <TargetEnvironmentSection />
        <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
        <TargetBindingSection />
        <TargetEnvVarSection />
      </div>
    </StepShell>
  )
}
