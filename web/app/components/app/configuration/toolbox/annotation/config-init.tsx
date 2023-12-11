'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Item } from './config-param'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import { useProviderContext } from '@/context/provider-context'

type Props = {
  isShow: boolean
  onHide: () => void
  onSave: (data: any) => void
}

const ConfigInit: FC<Props> = ({
  isShow,
  onHide: doHide,
  onSave,
}) => {
  const { t } = useTranslation()
  const {
    embeddingsDefaultModel,
  } = useProviderContext()
  const [isLoading, setLoading] = useState(false)
  const [embeddingModel, setEmbeddingModel] = useState(embeddingsDefaultModel
    ? {
      providerName: embeddingsDefaultModel.model_provider.provider_name,
      modelName: embeddingsDefaultModel.model_name,
    }
    : undefined)
  const onHide = () => {
    if (!isLoading)
      doHide()
  }
  const handleSave = () => {
    setLoading(true)
    setTimeout(() => {
      onSave({})
      setLoading(false)
      onHide()
    }, 3000)
  }

  return (
    <Modal
      isShow={isShow}
      onClose={onHide}
      className='!p-8 !pb-6 !mt-14 !max-w-none !w-[640px]'
      wrapperClassName='!z-50'
    >
      <div className='mb-2 text-xl font-semibold text-[#1D2939]'>
        {t('appAnnotation.initSetup.title')}
      </div>

      <Item
        title={t('common.modelProvider.embeddingModel.key')}
        tooltip={t('common.modelProvider.embeddingModel.tip')}
      >
        <div className='pt-1'>
          {/* TODO: Potal */}
          <ModelSelector
            value={embeddingModel}
            modelType={ModelType.embeddings}
            onChange={(val) => {
              setEmbeddingModel({
                providerName: val.model_provider.provider_name,
                modelName: val.model_name,
              })
            }}
          />
        </div>
      </Item>

      <div className='mt-4 flex gap-2 justify-end'>
        <Button onClick={onHide}>{t('common.operation.cancel')}</Button>
        <Button
          type='primary'
          onClick={handleSave}
          className='flex items-center border-[0.5px]'
          loading={isLoading}
        >
          <div></div>
          <div>{t('appAnnotation.initSetup.confirmBtn')}</div>
        </Button >
      </div >
    </Modal >
  )
}
export default React.memo(ConfigInit)
