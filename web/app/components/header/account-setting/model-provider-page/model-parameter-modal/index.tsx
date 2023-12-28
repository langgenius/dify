import type { FC } from 'react'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import type {
  DefaultModel,
  FormValue,
  ModelParameterRule,
} from '../declarations'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import ModelSelector from '../model-selector'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '../hooks'
import ParameterItem from './parameter-item'
import type { ParameterValue } from './parameter-item'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { SlidersH } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'
import { fetchModelParameterRules } from '@/service/common'
import Loading from '@/app/components/base/loading'

type ModelParameterModalProps = {
  isAdvancedMode: boolean
  mode: string
  modelId: string
  provider: string
  setModel: (model: { modelId: string; provider: string; mode?: string; features: string[] }) => void
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
  disabled: boolean
}
const stopParameerRule: ModelParameterRule = {
  default: [],
  help: {
    en_US: 'Up to four sequences where the API will stop generating further tokens. The returned text will not contain the stop sequence.',
    zh_Hans: '最多四个序列，API 将停止生成更多的 token。返回的文本将不包含停止序列。',
  },
  label: {
    en_US: 'Stop sequences',
    zh_Hans: '停止序列 stop_sequences',
  },
  name: 'stop',
  required: false,
  type: 'tag',
  tagPlaceholder: {
    en_US: 'Enter sequence and press Tab',
    zh_Hans: '输入序列并按 Tab 键',
  },
}
const ModelParameterModal: FC<ModelParameterModalProps> = ({
  isAdvancedMode,
  modelId,
  provider,
  setModel,
  completionParams,
  onCompletionParamsChange,
  disabled,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: parameterRulesData, isLoading } = useSWR(`/workspaces/current/model-providers/${provider}/models/parameter-rules?model=${modelId}`, fetchModelParameterRules)
  const {
    currentProvider,
    currentModel,
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    { provider, model: modelId },
  )

  const parameterRules = parameterRulesData?.data || []

  const handleParamChange = (key: string, value: ParameterValue) => {
    onCompletionParamsChange({
      ...completionParams,
      [key]: value,
    })
  }

  const handleChangeModel = ({ provider, model }: DefaultModel) => {
    const targetProvider = textGenerationModelList.find(modelItem => modelItem.provider === provider)
    const targetModelItem = targetProvider?.models.find(modelItem => modelItem.model === model)
    setModel({
      modelId: model,
      provider,
      mode: targetModelItem?.model_properties.mode as string,
      features: targetModelItem?.features || [],
    })
  }

  const handleChangeParams = () => {
    const newCompletionParams = parameterRules.reduce((acc, parameter) => {
      if (parameter.default !== undefined)
        acc[parameter.name] = parameter.default

      return acc
    }, {} as Record<string, any>)

    onCompletionParamsChange(newCompletionParams)
  }

  useEffect(() => {
    handleChangeParams()
  }, [parameterRules])

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

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className='block'
        >
          <div
            className={`
              flex items-center px-2 h-8 rounded-lg border cursor-pointer hover:border-[1.5px]
              ${disabled ? 'border-[#F79009] bg-[#FFFAEB]' : 'border-[#444CE7] bg-primary-50'}
            `}
          >
            {
              currentProvider && (
                <ModelIcon
                  className='mr-1.5 !w-5 !h-5'
                  provider={currentProvider}
                  modelName={currentModel?.model}
                />
              )
            }
            {
              currentModel && (
                <ModelName
                  className='mr-1.5 text-gray-900'
                  modelItem={currentModel}
                  showMode={isAdvancedMode}
                  modeClassName='!text-[#444CE7] !border-[#A4BCFD]'
                  showFeatures={isAdvancedMode}
                  featuresClassName='!text-[#444CE7] !border-[#A4BCFD]'
                />
              )
            }
            {
              disabled
                ? (
                  <AlertTriangle className='w-4 h-4 text-[#F79009]' />
                )
                : (
                  <SlidersH className='w-4 h-4 text-indigo-600' />
                )
            }
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent>
          <div className='w-[496px] rounded-xl border border-gray-100 bg-white shadow-xl'>
            <div className='flex items-center px-4 h-12 rounded-t-xl border-b border-gray-100 bg-gray-50 text-md font-medium text-gray-900'>
              <CubeOutline className='mr-2 w-4 h-4 text-primary-600' />
              {t('common.modelProvider.modelAndParameters')}
            </div>
            <div className='px-10 pt-4 pb-8'>
              <div className='flex items-center justify-between h-8'>
                <div className='text-sm font-medium text-gray-900'>
                  {t('common.modelProvider.model')}
                </div>
                <ModelSelector
                  defaultModel={{ provider, model: modelId }}
                  modelList={textGenerationModelList}
                  onSelect={handleChangeModel}
                />
              </div>
              <div className='my-5 h-[1px] bg-gray-100' />
              {
                isLoading && (
                  <Loading />
                )
              }
              {
                !isLoading && (
                  [
                    ...parameterRules,
                    ...(isAdvancedMode ? [stopParameerRule] : []),
                  ].map(parameter => (
                    <ParameterItem
                      key={parameter.name}
                      className='mb-4'
                      parameterRule={parameter}
                      value={completionParams[parameter.name]}
                      onChange={v => handleParamChange(parameter.name, v)}
                      onSwitch={(checked, assignValue) => handleSwitch(parameter.name, checked, assignValue)}
                    />
                  ))
                )
              }
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default ModelParameterModal
