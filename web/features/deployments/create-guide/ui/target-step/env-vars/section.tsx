'use client'

import type { EnvVarValueSelection } from '@/features/deployments/components/env-var-bindings'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  EnvVarBindingsPanel,
} from '@/features/deployments/components/env-var-bindings'
import {
  deploymentOptionsQueryAtom,
  deploymentTargetEnvVarSlotsAtom,
  envVarValuesAtom,
  setEnvVarAtom,
} from '@/features/deployments/create-guide/state'

export function TargetEnvVarSection() {
  const { t } = useTranslation('deployments')
  const setEnvVar = useSetAtom(setEnvVarAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const deploymentOptionsQuery = useAtomValue(deploymentOptionsQueryAtom)
  const envVarSlots = useAtomValue(deploymentTargetEnvVarSlotsAtom)
  const isBindingError = deploymentOptionsQuery.isError
  const isBindingLoading = deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data)

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
