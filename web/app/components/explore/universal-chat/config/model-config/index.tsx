'use client'
import type { FC } from 'react'
import React from 'react'
import { useBoolean, useClickAway } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { UNIVERSAL_CHAT_MODEL_LIST as MODEL_LIST } from '@/config'
import { ModelType, type ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
export type IModelConfigProps = {
  modelId: string
  providerName: ProviderEnum
  onChange?: (modelId: string, providerName: ProviderEnum) => void
  readonly?: boolean
}

const ModelConfig: FC<IModelConfigProps> = ({
  modelId,
  providerName,
  onChange,
  readonly,
}) => {
  const { t } = useTranslation()

  const currModel = MODEL_LIST.find(item => item.id === modelId)
  const [isShowOption, { setFalse: hideOption, toggle: toogleOption }] = useBoolean(false)
  const triggerRef = React.useRef(null)
  useClickAway(() => {
    hideOption()
  }, triggerRef)

  return (
    <div className='flex items-center justify-between h-[52px] px-3 rounded-xl bg-gray-50'>
      <div className='text-sm font-semibold text-gray-800'>{t('explore.universalChat.model')}</div>
      <ModelSelector
        popClassName="right-0"
        modelType={ModelType.textGeneration}
        supportAgentThought
        value={{
          modelName: modelId,
          providerName,
        }}
        onChange={(model) => {
          onChange?.(model.model_name, model.model_provider.provider_name)
        }}
      />
    </div>
  )
}
export default React.memo(ModelConfig)
