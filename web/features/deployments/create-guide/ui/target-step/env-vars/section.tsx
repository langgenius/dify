'use client'

import type { EnvVarValueSelection } from '@/features/deployments/components/env-var-bindings'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  EnvVarBindingsPanel,
} from '@/features/deployments/components/env-var-bindings'
import {
  envVarValuesAtom,
  setEnvVarAtom,
} from '../../../state/target-atoms'
import {
  useTargetEnvVarIsBindingError,
  useTargetEnvVarIsBindingLoading,
  useTargetEnvVarSlots,
} from './section.data'

export function TargetEnvVarSection() {
  const { t } = useTranslation('deployments')
  const envVarSlots = useTargetEnvVarSlots()
  const envVarValues = useAtomValue(envVarValuesAtom)
  const setEnvVar = useSetAtom(setEnvVarAtom)
  const isBindingError = useTargetEnvVarIsBindingError()
  const isBindingLoading = useTargetEnvVarIsBindingLoading()

  function onSetEnvVar(key: string, value: EnvVarValueSelection) {
    setEnvVar({ key, value })
  }

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
