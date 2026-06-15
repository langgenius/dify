import type {
  FormValue,
  ModelParameterRule,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ParameterValue } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/parameter-item'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import ParameterItem from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/parameter-item'
import PresetsParameter from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/presets-parameter'
import { getSupportedPresetConfig } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/presets-parameter-utils'
import { PROVIDER_WITH_PRESET_TONE, STOP_PARAMETER_RULE } from '@/config'
import { useModelParameterRules } from '@/service/use-common'

type Props = Readonly<{
  isAdvancedMode: boolean
  provider: string
  modelId: string
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
}>

const LLMParamsPanel = ({
  isAdvancedMode,
  provider,
  modelId,
  completionParams,
  onCompletionParamsChange,
}: Props) => {
  const { t } = useTranslation()
  const { data: parameterRulesData, isLoading } = useModelParameterRules(provider, modelId)
  const isRulesLoading = !!provider && !!modelId && isLoading

  const parameterRules: ModelParameterRule[] = useMemo(() => {
    return parameterRulesData?.data || []
  }, [parameterRulesData])
  const supportedPresetParameterNames = useMemo(() => {
    return parameterRules.map(parameterRule => parameterRule.name)
  }, [parameterRules])

  const handleSelectPresetParameter = (toneId: number) => {
    onCompletionParamsChange({
      ...completionParams,
      ...getSupportedPresetConfig(toneId, supportedPresetParameterNames),
    })
  }
  const handleParamChange = (key: string, value: ParameterValue) => {
    onCompletionParamsChange({
      ...completionParams,
      [key]: value,
    })
  }
  const handleSwitch = (key: string, value: boolean, assignValue: ParameterValue) => {
    if (!value) {
      const newCompletionParams = { ...completionParams }
      delete newCompletionParams[key]

      onCompletionParamsChange(newCompletionParams)
    }
    if (value) {
      onCompletionParamsChange({
        ...completionParams,
        [key]: assignValue,
      })
    }
  }

  if (isRulesLoading) {
    return (
      <div className="mt-5"><Loading /></div>
    )
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className={cn('flex h-6 items-center system-sm-semibold text-text-secondary')}>{t('modelProvider.parameters', { ns: 'common' })}</div>
        {
          PROVIDER_WITH_PRESET_TONE.includes(provider) && (
            <PresetsParameter
              onSelect={handleSelectPresetParameter}
              supportedParameterNames={supportedPresetParameterNames}
            />
          )
        }
      </div>
      {!!parameterRules.length && (
        [
          ...parameterRules,
          ...(isAdvancedMode ? [STOP_PARAMETER_RULE] : []),
        ].map(parameter => (
          <ParameterItem
            key={`${modelId}-${parameter.name}`}
            parameterRule={parameter}
            value={completionParams?.[parameter.name]}
            onChange={v => handleParamChange(parameter.name, v)}
            onSwitch={(checked, assignValue) => handleSwitch(parameter.name, checked, assignValue)}
            isInWorkflow
          />
        )))}
    </>
  )
}

export default LLMParamsPanel
