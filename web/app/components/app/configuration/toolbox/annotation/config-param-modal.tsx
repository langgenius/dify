'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ScoreSlider from '../score-slider'
import { Item } from './config-param'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import type { AnnotationReplyConfig } from '@/models/debug'
import { ANNOTATION_DEFAULT } from '@/config'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

type Props = {
  appId: string
  isShow: boolean
  onHide: () => void
  onSave: (embeddingModel: {
    embedding_provider_name: string
    embedding_model_name: string
  }, score: number) => void
  isInit?: boolean
  annotationConfig: AnnotationReplyConfig
}

const ConfigParamModal: FC<Props> = ({
  isShow,
  onHide: doHide,
  onSave,
  isInit,
  annotationConfig: oldAnnotationConfig,
}) => {
  const { t } = useTranslation()
  const {
    modelList: embeddingsModelList,
    defaultModel: embeddingsDefaultModel,
    currentModel: isEmbeddingsDefaultModelValid,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textEmbedding)
  const [annotationConfig, setAnnotationConfig] = useState(oldAnnotationConfig)

  const [isLoading, setLoading] = useState(false)
  const [embeddingModel, setEmbeddingModel] = useState(oldAnnotationConfig.embedding_model
    ? {
      providerName: oldAnnotationConfig.embedding_model.embedding_provider_name,
      modelName: oldAnnotationConfig.embedding_model.embedding_model_name,
    }
    : (embeddingsDefaultModel
      ? {
        providerName: embeddingsDefaultModel.provider.provider,
        modelName: embeddingsDefaultModel.model,
      }
      : undefined))
  const onHide = () => {
    if (!isLoading)
      doHide()
  }

  const handleSave = async () => {
    if (!embeddingModel || !embeddingModel.modelName || (embeddingModel.modelName === embeddingsDefaultModel?.model && !isEmbeddingsDefaultModelValid)) {
      Toast.notify({
        message: t('common.modelProvider.embeddingModel.required'),
        type: 'error',
      })
      return
    }
    setLoading(true)
    await onSave({
      embedding_provider_name: embeddingModel.providerName,
      embedding_model_name: embeddingModel.modelName,
    }, annotationConfig.score_threshold)
    setLoading(false)
  }

  return (
    <Modal
      isShow={isShow}
      onClose={onHide}
      className='!p-8 !pb-6 !mt-14 !max-w-none !w-[640px]'
    >
      <div className='mb-2 text-xl font-semibold text-[#1D2939]'>
        {t(`appAnnotation.initSetup.${isInit ? 'title' : 'configTitle'}`)}
      </div>

      <div className='mt-6 space-y-3'>
        <Item
          title={t('appDebug.feature.annotation.scoreThreshold.title')}
          tooltip={t('appDebug.feature.annotation.scoreThreshold.description')}
        >
          <ScoreSlider
            className='mt-1'
            value={(annotationConfig.score_threshold || ANNOTATION_DEFAULT.score_threshold) * 100}
            onChange={(val) => {
              setAnnotationConfig({
                ...annotationConfig,
                score_threshold: val / 100,
              })
            }}
          />
        </Item>

        <Item
          title={t('common.modelProvider.embeddingModel.key')}
          tooltip={t('appAnnotation.embeddingModelSwitchTip')}
        >
          <div className='pt-1'>
            <ModelSelector
              defaultModel={embeddingModel && {
                provider: embeddingModel.providerName,
                model: embeddingModel.modelName,
              }}
              modelList={embeddingsModelList}
              onSelect={(val) => {
                setEmbeddingModel({
                  providerName: val.provider,
                  modelName: val.model,
                })
              }}
            />
          </div>
        </Item>
      </div>

      <div className='mt-6 flex gap-2 justify-end'>
        <Button onClick={onHide}>{t('common.operation.cancel')}</Button>
        <Button
          variant='primary'
          onClick={handleSave}
          loading={isLoading}
        >
          <div></div>
          <div>{t(`appAnnotation.initSetup.${isInit ? 'confirmBtn' : 'configConfirmBtn'}`)}</div>
        </Button >
      </div >
    </Modal >
  )
}
export default React.memo(ConfigParamModal)
