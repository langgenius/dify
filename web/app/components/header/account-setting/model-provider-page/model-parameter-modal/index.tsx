import type { FC } from 'react'
import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import type {
  FormValue,
} from '../declarations'
import { ModelTypeEnum } from '../declarations'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import ModelSelector from '../model-selector'
import ParameterItem from './parameter-item'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { SlidersH } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { useProviderContext } from '@/context/provider-context'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'
import { fetchModelParameterRules } from '@/service/common'

type ModelParameterModalProps = {
  isAdvancedMode: boolean
  mode: string
  modelId: string
  provider: string
  setModel: (model: { model: string; provider: string; mode?: string; features: string[] }) => void
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
  disabled: boolean
}
const ModelParameterModal: FC<ModelParameterModalProps> = ({
  isAdvancedMode,
  mode,
  modelId,
  provider,
  setModel,
  completionParams,
  onCompletionParamsChange,
  disabled,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: parameterRulesData } = useSWR(`/workspaces/current/model-providers/${provider}/models/parameter-rules?model=${modelId}`, fetchModelParameterRules)
  const { textGenerationModelList } = useProviderContext()
  const currentProvider = textGenerationModelList.find(model => model.provider === provider)
  const currentModel = currentProvider?.models.find(modelItem => modelItem.model === modelId)

  const handleParamChange = (key: string, value: number | string[]) => {
    if (value === undefined)
      return

    if (key === 'stop') {
      onCompletionParamsChange({
        ...completionParams,
        [key]: value as string[],
      })
    }
    else {
      onCompletionParamsChange({
        ...completionParams,
        [key]: value,
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
                  providerName={provider}
                  modelType={ModelTypeEnum.textGeneration}
                />
              )
            }
            {
              currentModel && (
                <ModelName
                  className='mr-1.5 text-gray-900'
                  modelItem={currentModel}
                  showMode={isAdvancedMode}
                  showFeatures={isAdvancedMode}
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
                  onSelect={({ provider, model }) => {
                    const targetProvider = textGenerationModelList.find(modelItem => modelItem.provider === provider)
                    const targetModelItem = targetProvider?.models.find(modelItem => modelItem.model === model)
                    setModel({
                      model,
                      provider,
                      mode: targetModelItem?.model_properties.mode as string,
                      features: targetModelItem?.features || [],
                    })
                  }}
                />
              </div>
              <div className='my-5 h-[1px] bg-gray-100' />
              {
                parameterRulesData?.data && (
                  parameterRulesData.data.map(parameter => (
                    <ParameterItem
                      key={parameter.name}
                      className='mb-4'
                      parameterRule={parameter}
                      value={completionParams[parameter.name]}
                      onChange={v => handleParamChange(parameter.name, v)}
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
