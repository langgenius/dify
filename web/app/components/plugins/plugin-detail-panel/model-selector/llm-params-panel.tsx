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
import { TONE_LIST } from '@/config'
import cn from '@/utils/classnames'

const PROVIDER_WITH_PRESET_TONE = ['langgenius/openai/openai', 'langgenius/azure_openai/azure_openai']
const stopParameterRule: ModelParameterRule = {
  default: [],
  help: {
    en_US: 'Up to four sequences where the API will stop generating further tokens. The returned text will not contain the stop sequence.',
    zh_Hans: '最多四个序列，API 将停止生成更多的 token。返回的文本将不包含停止序列。',
  },
  label: {
    en_US: 'Stop sequences',
    zh_Hans: '停止序列',
  },
  name: 'stop',
  required: false,
  type: 'tag',
  tagPlaceholder: {
    en_US: 'Enter sequence and press Tab',
    zh_Hans: '输入序列并按 Tab 键',
  },
}

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
        <div className={cn('text-text-secondary system-sm-semibold flex h-6 items-center')}>{t('common.modelProvider.parameters')}</div>
        {
          PROVIDER_WITH_PRESET_TONE.includes(provider) && (
            <PresetsParameter onSelect={handleSelectPresetParameter} />
          )
        }
      </div>
      {!!parameterRules.length && (
        [
          ...parameterRules,
          ...(isAdvancedMode ? [stopParameterRule] : []),
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
