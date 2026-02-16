import type { FC } from 'react'
import type {
  DefaultModel,
  DefaultModelResponse,
} from '../declarations'
import { RiEqualizer2Line, RiLoader2Line } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useToastContext } from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { updateDefaultModel } from '@/service/common'
import { ModelTypeEnum } from '../declarations'
import {
  useModelList,
  useSystemDefaultModelAndModelList,
  useUpdateModelList,
} from '../hooks'
import ModelSelector from '../model-selector'

type SystemModelSelectorProps = {
  textGenerationDefaultModel: DefaultModelResponse | undefined
  embeddingsDefaultModel: DefaultModelResponse | undefined
  rerankDefaultModel: DefaultModelResponse | undefined
  speech2textDefaultModel: DefaultModelResponse | undefined
  ttsDefaultModel: DefaultModelResponse | undefined
  notConfigured: boolean
  isLoading?: boolean
}
const SystemModel: FC<SystemModelSelectorProps> = ({
  textGenerationDefaultModel,
  embeddingsDefaultModel,
  rerankDefaultModel,
  speech2textDefaultModel,
  ttsDefaultModel,
  notConfigured,
  isLoading,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { isCurrentWorkspaceManager } = useAppContext()
  const { textGenerationModelList } = useProviderContext()
  const updateModelList = useUpdateModelList()
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)
  const { data: speech2textModelList } = useModelList(ModelTypeEnum.speech2text)
  const { data: ttsModelList } = useModelList(ModelTypeEnum.tts)
  const [changedModelTypes, setChangedModelTypes] = useState<ModelTypeEnum[]>([])
  const [currentTextGenerationDefaultModel, changeCurrentTextGenerationDefaultModel] = useSystemDefaultModelAndModelList(textGenerationDefaultModel, textGenerationModelList)
  const [currentEmbeddingsDefaultModel, changeCurrentEmbeddingsDefaultModel] = useSystemDefaultModelAndModelList(embeddingsDefaultModel, embeddingModelList)
  const [currentRerankDefaultModel, changeCurrentRerankDefaultModel] = useSystemDefaultModelAndModelList(rerankDefaultModel, rerankModelList)
  const [currentSpeech2textDefaultModel, changeCurrentSpeech2textDefaultModel] = useSystemDefaultModelAndModelList(speech2textDefaultModel, speech2textModelList)
  const [currentTTSDefaultModel, changeCurrentTTSDefaultModel] = useSystemDefaultModelAndModelList(ttsDefaultModel, ttsModelList)
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
    else if (modelType === ModelTypeEnum.tts)
      return currentTTSDefaultModel

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
    else if (modelType === ModelTypeEnum.tts)
      changeCurrentTTSDefaultModel(model)

    if (!changedModelTypes.includes(modelType))
      setChangedModelTypes([...changedModelTypes, modelType])
  }
  const handleSave = async () => {
    const res = await updateDefaultModel({
      url: '/workspaces/current/default-model',
      body: {
        model_settings: [ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding, ModelTypeEnum.rerank, ModelTypeEnum.speech2text, ModelTypeEnum.tts].map((modelType) => {
          return {
            model_type: modelType,
            provider: getCurrentDefaultModelByModelType(modelType)?.provider,
            model: getCurrentDefaultModelByModelType(modelType)?.model,
          }
        }),
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      setOpen(false)

      changedModelTypes.forEach((modelType) => {
        if (modelType === ModelTypeEnum.textGeneration)
          updateModelList(modelType)
        else if (modelType === ModelTypeEnum.textEmbedding)
          updateModelList(modelType)
        else if (modelType === ModelTypeEnum.rerank)
          updateModelList(modelType)
        else if (modelType === ModelTypeEnum.speech2text)
          updateModelList(modelType)
        else if (modelType === ModelTypeEnum.tts)
          updateModelList(modelType)
      })
    }
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{
        mainAxis: 4,
        crossAxis: 8,
      }}
    >
      <PortalToFollowElemTrigger asChild onClick={() => setOpen(v => !v)}>
        <Button
          className="relative"
          variant={notConfigured ? 'primary' : 'secondary'}
          size="small"
          disabled={isLoading}
        >
          {isLoading
            ? <RiLoader2Line className="mr-1 h-3.5 w-3.5 animate-spin" />
            : <RiEqualizer2Line className="mr-1 h-3.5 w-3.5" />}
          {t('modelProvider.systemModelSettings', { ns: 'common' })}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[60]">
        <div className="w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg pt-4 shadow-xl">
          <div className="px-6 py-1">
            <div className="flex h-8 items-center text-[13px] font-medium text-text-primary">
              {t('modelProvider.systemReasoningModel.key', { ns: 'common' })}
              <Tooltip
                popupContent={(
                  <div className="w-[261px] text-text-tertiary">
                    {t('modelProvider.systemReasoningModel.tip', { ns: 'common' })}
                  </div>
                )}
                triggerClassName="ml-0.5 w-4 h-4 shrink-0"
              />
            </div>
            <div>
              <ModelSelector
                defaultModel={currentTextGenerationDefaultModel}
                modelList={textGenerationModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.textGeneration, model)}
              />
            </div>
          </div>
          <div className="px-6 py-1">
            <div className="flex h-8 items-center text-[13px] font-medium text-text-primary">
              {t('modelProvider.embeddingModel.key', { ns: 'common' })}
              <Tooltip
                popupContent={(
                  <div className="w-[261px] text-text-tertiary">
                    {t('modelProvider.embeddingModel.tip', { ns: 'common' })}
                  </div>
                )}
                triggerClassName="ml-0.5 w-4 h-4 shrink-0"
              />
            </div>
            <div>
              <ModelSelector
                defaultModel={currentEmbeddingsDefaultModel}
                modelList={embeddingModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.textEmbedding, model)}
              />
            </div>
          </div>
          <div className="px-6 py-1">
            <div className="flex h-8 items-center text-[13px] font-medium text-text-primary">
              {t('modelProvider.rerankModel.key', { ns: 'common' })}
              <Tooltip
                popupContent={(
                  <div className="w-[261px] text-text-tertiary">
                    {t('modelProvider.rerankModel.tip', { ns: 'common' })}
                  </div>
                )}
                triggerClassName="ml-0.5 w-4 h-4 shrink-0"
              />
            </div>
            <div>
              <ModelSelector
                defaultModel={currentRerankDefaultModel}
                modelList={rerankModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.rerank, model)}
              />
            </div>
          </div>
          <div className="px-6 py-1">
            <div className="flex h-8 items-center text-[13px] font-medium text-text-primary">
              {t('modelProvider.speechToTextModel.key', { ns: 'common' })}
              <Tooltip
                popupContent={(
                  <div className="w-[261px] text-text-tertiary">
                    {t('modelProvider.speechToTextModel.tip', { ns: 'common' })}
                  </div>
                )}
                triggerClassName="ml-0.5 w-4 h-4 shrink-0"
              />
            </div>
            <div>
              <ModelSelector
                defaultModel={currentSpeech2textDefaultModel}
                modelList={speech2textModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.speech2text, model)}
              />
            </div>
          </div>
          <div className="px-6 py-1">
            <div className="flex h-8 items-center text-[13px] font-medium text-text-primary">
              {t('modelProvider.ttsModel.key', { ns: 'common' })}
              <Tooltip
                popupContent={(
                  <div className="w-[261px] text-text-tertiary">
                    {t('modelProvider.ttsModel.tip', { ns: 'common' })}
                  </div>
                )}
                triggerClassName="ml-0.5 w-4 h-4 shrink-0"
              />
            </div>
            <div>
              <ModelSelector
                defaultModel={currentTTSDefaultModel}
                modelList={ttsModelList}
                onSelect={model => handleChangeDefaultModel(ModelTypeEnum.tts, model)}
              />
            </div>
          </div>
          <div className="flex items-center justify-end px-6 py-4">
            <Button
              onClick={() => setOpen(false)}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              className="ml-2"
              variant="primary"
              onClick={handleSave}
              disabled={!isCurrentWorkspaceManager}
            >
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SystemModel
