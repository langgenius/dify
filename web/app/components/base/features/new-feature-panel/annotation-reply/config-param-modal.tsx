'use client'
import type { FC } from 'react'
import type { AnnotationReplyConfig } from '@/models/debug'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { ANNOTATION_DEFAULT } from '@/config'
import { Item } from './config-param'
import ScoreSlider from './score-slider'

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
        message: t('modelProvider.embeddingModel.required', { ns: 'common' }),
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
      className="!mt-14 !w-[640px] !max-w-none !p-6"
    >
      <div className="title-2xl-semi-bold mb-2 text-text-primary">
        {t(`initSetup.${isInit ? 'title' : 'configTitle'}`, { ns: 'appAnnotation' })}
      </div>

      <div className="mt-6 space-y-3">
        <Item
          title={t('feature.annotation.scoreThreshold.title', { ns: 'appDebug' })}
          tooltip={t('feature.annotation.scoreThreshold.description', { ns: 'appDebug' })}
        >
          <ScoreSlider
            className="mt-1"
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
          title={t('modelProvider.embeddingModel.key', { ns: 'common' })}
          tooltip={t('embeddingModelSwitchTip', { ns: 'appAnnotation' })}
        >
          <div className="pt-1">
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

      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button
          variant="primary"
          onClick={handleSave}
          loading={isLoading}
        >
          <div></div>
          <div>{t(`initSetup.${isInit ? 'confirmBtn' : 'configConfirmBtn'}`, { ns: 'appAnnotation' })}</div>
        </Button>
      </div>
    </Modal>
  )
}
export default React.memo(ConfigParamModal)
