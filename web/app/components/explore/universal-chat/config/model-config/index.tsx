'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useProviderContext } from '@/context/provider-context'

export type IModelConfigProps = {
  modelId: string
  providerName: string
  onChange?: (modelId: string, providerName: string) => void
  readonly?: boolean
}

const ModelConfig: FC<IModelConfigProps> = ({
  modelId,
  providerName,
  onChange,
  readonly,
}) => {
  const { t } = useTranslation()
  const { agentThoughtModelList } = useProviderContext()

  return (
    <div className='flex items-center justify-between h-[52px] px-3 rounded-xl bg-gray-50'>
      <div className='text-sm font-semibold text-gray-800'>{t('explore.universalChat.model')}</div>
      <ModelSelector
        triggerClassName={`${readonly && '!cursor-not-allowed !opacity-60'}`}
        defaultModel={{ provider: providerName, model: modelId }}
        modelList={agentThoughtModelList}
        onSelect={(model) => {
          onChange?.(model.model, model.provider)
        }}
        readonly={readonly}
      />
    </div>
  )
}
export default React.memo(ModelConfig)
