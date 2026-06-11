'use client'

import { useTranslation } from 'react-i18next'
import {
  EnvVarBindingsPanel,
} from '@/features/deployments/components/env-var-bindings'
import {
  useTargetEnvVarChangeAction,
  useTargetEnvVarIsBindingError,
  useTargetEnvVarIsBindingLoading,
  useTargetEnvVarSlots,
  useTargetEnvVarValues,
} from './section.data'

export function TargetEnvVarSection() {
  const { t } = useTranslation('deployments')
  const envVarSlots = useTargetEnvVarSlots()
  const envVarValues = useTargetEnvVarValues()
  const isBindingError = useTargetEnvVarIsBindingError()
  const isBindingLoading = useTargetEnvVarIsBindingLoading()
  const onSetEnvVar = useTargetEnvVarChangeAction()

  if (isBindingLoading || isBindingError)
    return null

  return (
    <EnvVarBindingsPanel
      slots={envVarSlots}
      values={envVarValues}
      title={t('createGuide.target.envVars')}
      hint={t('createGuide.target.envVarHint')}
      envVarPlaceholder={t('createGuide.target.envVarPlaceholder')}
      literalSourceLabel={t('createGuide.target.envVarSource.literal')}
      defaultSourceLabel={t('createGuide.target.envVarSource.default')}
      lastDeploymentSourceLabel={t('createGuide.target.envVarSource.lastDeployment')}
      valueTypeLabels={{
        string: t('createGuide.target.envVarType.string'),
        number: t('createGuide.target.envVarType.number'),
        secret: t('createGuide.target.envVarType.secret'),
      }}
      sourceAriaLabel={key => t('createGuide.target.envVarSource.ariaLabel', { key })}
      envVarCountLabel={t('createGuide.target.envVarCount', { count: envVarSlots.length })}
      onChange={onSetEnvVar}
      listScrollable={false}
      className="border-components-option-card-option-border bg-components-option-card-option-bg"
    />
  )
}
