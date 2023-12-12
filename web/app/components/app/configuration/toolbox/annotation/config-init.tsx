'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnnotationEnableStatus } from '../../../annotation/type'
import { Item } from './config-param'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import { useProviderContext } from '@/context/provider-context'
import Toast from '@/app/components/base/toast'
import { queryAnnotationJobStatus, updateAnnotationStatus } from '@/service/annotation'
import { sleep } from '@/utils'

type Props = {
  appId: string
  isShow: boolean
  onHide: () => void
  onSave: (embeddingModel: {
    embedding_provider_name: string
    embedding_model_name: string
  }) => void
}

const ConfigInit: FC<Props> = ({
  appId,
  isShow,
  onHide: doHide,
  onSave,
}) => {
  const { t } = useTranslation()
  const {
    embeddingsDefaultModel,
    isEmbeddingsDefaultModelValid,
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

  const ensureJobCompleted = async (jobId: string) => {
    let isCompleted = false
    while (!isCompleted) {
      const res: any = await queryAnnotationJobStatus(appId, AnnotationEnableStatus.enable, jobId)
      isCompleted = res.status === 'completed'
      await sleep(500)
    }
  }
  const handleSave = async () => {
    if (!embeddingModel || !embeddingModel.modelName || (embeddingModel.modelName === embeddingsDefaultModel?.model_name && !isEmbeddingsDefaultModelValid)) {
      Toast.notify({
        message: t('common.modelProvider.embeddingModel.required'),
        type: 'error',
      })
      return
    }
    setLoading(true)
    onSave({
      embedding_provider_name: embeddingModel.providerName,
      embedding_model_name: embeddingModel.modelName,
    })

    const { job_id: jobId }: any = await updateAnnotationStatus(appId, AnnotationEnableStatus.enable)
    await ensureJobCompleted(jobId)
    setLoading(false)
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
