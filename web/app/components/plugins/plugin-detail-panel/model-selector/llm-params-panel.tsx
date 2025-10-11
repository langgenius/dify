import React, { useMemo } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import PresetsParameter from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/presets-parameter'
import ParameterItem from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/parameter-item'
import Loading from '@/app/components/base/loading'
import type {
  FormValue,
  ModelParameterRule,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ParameterValue } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/parameter-item'
import { fetchModelParameterRules } from '@/service/common'
import { PROVIDER_WITH_PRESET_TONE, STOP_PARAMETER_RULE, TONE_LIST } from '@/config'
import cn from '@/utils/classnames'

type Props = {
  isAdvancedMode: boolean
  provider: string
  modelId: string
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
}

const LLMParamsPanel = ({
  isAdvancedMode,
  provider,
  modelId,
  completionParams,
  onCompletionParamsChange,
}: Props) => {
  const { t } = useTranslation()
  const { data: parameterRulesData, isLoading } = useSWR(
    (provider && modelId)
      ? `/workspaces/current/model-providers/${provider}/models/parameter-rules?model=${modelId}`
      : null, fetchModelParameterRules,
  )

  const parameterRules: ModelParameterRule[] = useMemo(() => {
    return parameterRulesData?.data || []
  }, [parameterRulesData])

  const handleSelectPresetParameter = (toneId: number) => {
    const tone = TONE_LIST.find(tone => tone.id === toneId)
    if (tone) {
      onCompletionParamsChange({
        ...completionParams,
        ...tone.config,
      })
    }
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

  if (isLoading) {
    return (
      <div className='mt-5'><Loading /></div>
    )
  }

  return (
    <>
      <div className='mb-2 flex items-center justify-between'>
        <div className={cn('system-sm-semibold flex h-6 items-center text-text-secondary')}>{t('common.modelProvider.parameters')}</div>
        {
          PROVIDER_WITH_PRESET_TONE.includes(provider) && (
            <PresetsParameter onSelect={handleSelectPresetParameter} />
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
