import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModelSelector from '../model-selector'
import { useDefaultModelAndModelList } from '../hooks'
import type { DefaultModel } from '../declarations'
import { ModelTypeEnum } from '../declarations'
import Tooltip from '@/app/components/base/tooltip'
import { HelpCircle, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import { useProviderContext } from '@/context/provider-context'
import { updateDefaultModel } from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'

type SystemModelSelectorProps = {
  onUpdate: () => void
}
const SystemModel: FC<SystemModelSelectorProps> = ({
  onUpdate,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const {
    textGenerationDefaultModel,
    textGenerationModelList,
    embeddingsDefaultModel,
    embeddingsModelList,
    rerankDefaultModel,
    rerankModelList,
    speech2textDefaultModel,
    speech2textModelList,
    updateModelList,
  } = useProviderContext()
  const [changedModelTypes, setChangedModelTypes] = useState<ModelTypeEnum[]>([])
  const [currentTextGenerationDefaultModel, changeCurrentTextGenerationDefaultModel] = useDefaultModelAndModelList(textGenerationDefaultModel, textGenerationModelList)
  const [currentEmbeddingsDefaultModel, changeCurrentEmbeddingsDefaultModel] = useDefaultModelAndModelList(embeddingsDefaultModel, embeddingsModelList)
  const [currentRerankDefaultModel, changeCurrentRerankDefaultModel] = useDefaultModelAndModelList(rerankDefaultModel, rerankModelList)
  const [currentSpeech2textDefaultModel, changeCurrentSpeech2textDefaultModel] = useDefaultModelAndModelList(speech2textDefaultModel, speech2textModelList)
  const [open, setOpen] = useState(false)

  const getCurrentDefaultModelByModelType = (modelType: ModelTypeEnum) => {
    if (modelType === ModelTypeEnum.textGeneration)
      return currentTextGenerationDefaultModel
    else if (modelType === ModelTypeEnum.textEmbedding)
      return currentEmbeddingsDefaultModel
    else if (modelType === ModelTypeEnum.rerank)
      return currentRerankDefaultModel
    else if (modelType === ModelTypeEnum.speech2text)
      return currentSpeech2textDefaultModel

    return undefined
  }
  const handleChangeDefaultModel = (modelType: ModelTypeEnum, model: DefaultModel) => {
    if (modelType === ModelTypeEnum.textGeneration)
      changeCurrentTextGenerationDefaultModel(model)
    else if (modelType === ModelTypeEnum.textEmbedding)
      changeCurrentEmbeddingsDefaultModel(model)
    else if (modelType === ModelTypeEnum.rerank)
      changeCurrentRerankDefaultModel(model)
    else if (modelType === ModelTypeEnum.speech2text)
      changeCurrentSpeech2textDefaultModel(model)

    if (!changedModelTypes.includes(modelType))
      setChangedModelTypes([...changedModelTypes, modelType])
  }
  const handleSave = async () => {
    const res = await updateDefaultModel({
      url: '/workspaces/current/default-model',
      body: {
        model_settings: [ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding, ModelTypeEnum.rerank, ModelTypeEnum.speech2text].map((modelType) => {
          return {
            model_type: modelType,
            provider_name: getCurrentDefaultModelByModelType(modelType)?.provider,
            model_name: getCurrentDefaultModelByModelType(modelType)?.model,
          }
        }),
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      setOpen(false)
      onUpdate()

      changedModelTypes.forEach((modelType) => {
        if (modelType === ModelTypeEnum.textGeneration)
          updateModelList(modelType)
        else if (modelType === ModelTypeEnum.textEmbedding)
          updateModelList(modelType)
        else if (modelType === ModelTypeEnum.rerank)
          updateModelList(modelType)
        else if (modelType === ModelTypeEnum.speech2text)
          updateModelList(modelType)
      })
    }
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 8,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className={`
          flex items-center px-2 h-6 text-xs text-gray-700 cursor-pointer bg-white rounded-md border-[0.5px] border-gray-200 shadow-xs
          hover:bg-gray-100 hover:shadow-none
          ${open && 'bg-gray-100 shadow-none'}
        `}>
          <Settings01 className='mr-1 w-3 h-3 text-gray-500' />
          {t('common.modelProvider.systemModelSettings')}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-50'>
        <div className='pt-4 w-[360px] rounded-xl border-[0.5px] border-black/5 bg-white shadow-xl'>
          <div className='px-6 py-1'>
            <div className='flex items-center h-8 text-[13px] font-medium text-gray-900'>
              {t('common.modelProvider.systemReasoningModel.key')}
              <Tooltip
                selector='model-page-system-reasoning-model-tip'
                htmlContent={
                  <div className='w-[261px] text-gray-500'>{t('common.modelProvider.systemReasoningModel.tip')}</div>
                }
              >
                <HelpCircle className='ml-0.5 w-[14px] h-[14px] text-gray-400' />
              </Tooltip>
            </div>
            <div>
              <ModelSelector
                defaultModel={currentTextGenerationDefaultModel}
                modelList={textGenerationModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.textGeneration, model)}
                popupClassName='z-[60]'
              />
            </div>
          </div>
          <div className='px-6 py-1'>
            <div className='flex items-center h-8 text-[13px] font-medium text-gray-900'>
              {t('common.modelProvider.embeddingModel.key')}
              <Tooltip
                selector='model-page-system-embedding-model-tip'
                htmlContent={
                  <div className='w-[261px] text-gray-500'>{t('common.modelProvider.embeddingModel.tip')}</div>
                }
              >
                <HelpCircle className='ml-0.5 w-[14px] h-[14px] text-gray-400' />
              </Tooltip>
            </div>
            <div>
              <ModelSelector
                defaultModel={currentEmbeddingsDefaultModel}
                modelList={embeddingsModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.textEmbedding, model)}
                popupClassName='z-[60]'
              />
            </div>
          </div>
          <div className='px-6 py-1'>
            <div className='flex items-center h-8 text-[13px] font-medium text-gray-900'>
              {t('common.modelProvider.rerankModel.key')}
              <Tooltip
                selector='model-page-system-rerankModel-model-tip'
                htmlContent={
                  <div className='w-[261px] text-gray-500'>{t('common.modelProvider.rerankModel.tip')}</div>
                }
              >
                <HelpCircle className='ml-0.5 w-[14px] h-[14px] text-gray-400' />
              </Tooltip>
            </div>
            <div>
              <ModelSelector
                defaultModel={currentRerankDefaultModel}
                modelList={rerankModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.rerank, model)}
                popupClassName='z-[60]'
              />
            </div>
          </div>
          <div className='px-6 py-1'>
            <div className='flex items-center h-8 text-[13px] font-medium text-gray-900'>
              {t('common.modelProvider.speechToTextModel.key')}
              <Tooltip
                selector='model-page-system-speechToText-model-tip'
                htmlContent={
                  <div className='w-[261px] text-gray-500'>{t('common.modelProvider.speechToTextModel.tip')}</div>
                }
              >
                <HelpCircle className='ml-0.5 w-[14px] h-[14px] text-gray-400' />
              </Tooltip>
            </div>
            <div>
              <ModelSelector
                defaultModel={currentSpeech2textDefaultModel}
                modelList={speech2textModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.speech2text, model)}
                popupClassName='z-[60]'
              />
            </div>
          </div>
          <div className='flex items-center justify-end px-6 py-4'>
            <Button
              className='mr-2 !h-8 !text-[13px]'
              onClick={() => setOpen(false)}
            >
              {t('common.operation.cancel')}
            </Button>
            <Button
              type='primary'
              className='!h-8 !text-[13px]'
              onClick={handleSave}
            >
              {t('common.operation.save')}
            </Button>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SystemModel
