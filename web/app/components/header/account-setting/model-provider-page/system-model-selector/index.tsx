import type { FC } from 'react'
import type {
  DefaultModel,
  DefaultModelResponse,
} from '../declarations'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/base/ui/tooltip'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { updateDefaultModel } from '@/service/common'
import { ModelTypeEnum } from '../declarations'
import {
  useInvalidateDefaultModel,
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

type SystemModelLabelKey
  = | 'modelProvider.systemReasoningModel.key'
    | 'modelProvider.embeddingModel.key'
    | 'modelProvider.rerankModel.key'
    | 'modelProvider.speechToTextModel.key'
    | 'modelProvider.ttsModel.key'

type SystemModelTipKey
  = | 'modelProvider.systemReasoningModel.tip'
    | 'modelProvider.embeddingModel.tip'
    | 'modelProvider.rerankModel.tip'
    | 'modelProvider.speechToTextModel.tip'
    | 'modelProvider.ttsModel.tip'

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
  const { isCurrentWorkspaceManager } = useAppContext()
  const { textGenerationModelList } = useProviderContext()
  const updateModelList = useUpdateModelList()
  const invalidateDefaultModel = useInvalidateDefaultModel()
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
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      setOpen(false)

      const allModelTypes = [ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding, ModelTypeEnum.rerank, ModelTypeEnum.speech2text, ModelTypeEnum.tts]
      allModelTypes.forEach(type => invalidateDefaultModel(type))
      changedModelTypes.forEach(type => updateModelList(type))
    }
  }

  const renderModelLabel = (labelKey: SystemModelLabelKey, tipKey: SystemModelTipKey) => {
    const tipText = t(tipKey, { ns: 'common' })

    return (
      <div className="flex min-h-6 items-center text-[13px] font-medium text-text-secondary">
        {t(labelKey, { ns: 'common' })}
        <Tooltip>
          <TooltipTrigger
            aria-label={tipText}
            delay={0}
            render={(
              <span className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
              </span>
            )}
          />
          <TooltipContent>
            <div className="w-[261px] text-text-tertiary">
              {tipText}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <>
      <Button
        className="relative"
        variant={notConfigured ? 'primary' : 'secondary'}
        size="small"
        disabled={isLoading}
        onClick={() => setOpen(true)}
      >
        {isLoading
          ? <span className="mr-1 i-ri-loader-2-line h-3.5 w-3.5 animate-spin" />
          : <span className="mr-1 i-ri-equalizer-2-line h-3.5 w-3.5" />}
        {t('modelProvider.systemModelSettings', { ns: 'common' })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          backdropProps={{ forceRender: true }}
          className="w-[480px] max-w-[480px] overflow-hidden p-0"
        >
          <DialogCloseButton className="top-5 right-5" />
          <div className="px-6 pt-6 pr-14 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('modelProvider.systemModelSettings', { ns: 'common' })}
            </DialogTitle>
          </div>
          <div className="flex flex-col gap-4 px-6 py-3">
            <div className="flex flex-col gap-1">
              {renderModelLabel('modelProvider.systemReasoningModel.key', 'modelProvider.systemReasoningModel.tip')}
              <div>
                <ModelSelector
                  defaultModel={currentTextGenerationDefaultModel}
                  modelList={textGenerationModelList}
                  onSelect={model => handleChangeDefaultModel(ModelTypeEnum.textGeneration, model)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {renderModelLabel('modelProvider.embeddingModel.key', 'modelProvider.embeddingModel.tip')}
              <div>
                <ModelSelector
                  defaultModel={currentEmbeddingsDefaultModel}
                  modelList={embeddingModelList}
                  onSelect={model => handleChangeDefaultModel(ModelTypeEnum.textEmbedding, model)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {renderModelLabel('modelProvider.rerankModel.key', 'modelProvider.rerankModel.tip')}
              <div>
                <ModelSelector
                  defaultModel={currentRerankDefaultModel}
                  modelList={rerankModelList}
                  onSelect={model => handleChangeDefaultModel(ModelTypeEnum.rerank, model)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {renderModelLabel('modelProvider.speechToTextModel.key', 'modelProvider.speechToTextModel.tip')}
              <div>
                <ModelSelector
                  defaultModel={currentSpeech2textDefaultModel}
                  modelList={speech2textModelList}
                  onSelect={model => handleChangeDefaultModel(ModelTypeEnum.speech2text, model)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {renderModelLabel('modelProvider.ttsModel.key', 'modelProvider.ttsModel.tip')}
              <div>
                <ModelSelector
                  defaultModel={currentTTSDefaultModel}
                  modelList={ttsModelList}
                  onSelect={model => handleChangeDefaultModel(ModelTypeEnum.tts, model)}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-6 pt-5 pb-6">
            <Button
              className="min-w-[72px]"
              onClick={() => setOpen(false)}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              className="min-w-[72px]"
              variant="primary"
              onClick={handleSave}
              disabled={!isCurrentWorkspaceManager}
            >
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default SystemModel
