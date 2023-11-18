import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModelSelector from '../model-selector'
import type {
  BackendModel, ProviderEnum,
} from '../declarations'
import Tooltip from '@/app/components/base/tooltip'
import { HelpCircle, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useProviderContext } from '@/context/provider-context'
import { updateDefaultModel } from '@/service/common'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import { useToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'

const SystemModel = () => {
  const { t } = useTranslation()
  const {
    textGenerationDefaultModel,
    mutateTextGenerationDefaultModel,
    embeddingsDefaultModel,
    mutateEmbeddingsDefaultModel,
    speech2textDefaultModel,
    mutateSpeech2textDefaultModel,
    rerankDefaultModel,
    mutateRerankDefaultModel,
  } = useProviderContext()
  const { notify } = useToastContext()
  const [open, setOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<Record<ModelType, { providerName: ProviderEnum; modelName: string } | undefined>>({
    [ModelType.textGeneration]: textGenerationDefaultModel && { providerName: textGenerationDefaultModel.model_provider.provider_name, modelName: textGenerationDefaultModel.model_name },
    [ModelType.embeddings]: embeddingsDefaultModel && { providerName: embeddingsDefaultModel.model_provider.provider_name, modelName: embeddingsDefaultModel.model_name },
    [ModelType.speech2text]: speech2textDefaultModel && { providerName: speech2textDefaultModel.model_provider.provider_name, modelName: speech2textDefaultModel.model_name },
    [ModelType.reranking]: rerankDefaultModel && { providerName: rerankDefaultModel.model_provider.provider_name, modelName: rerankDefaultModel.model_name },
  })

  const mutateDefaultModel = (types: ModelType[]) => {
    types.forEach((type) => {
      if (type === ModelType.textGeneration)
        mutateTextGenerationDefaultModel()
      if (type === ModelType.embeddings)
        mutateEmbeddingsDefaultModel()
      if (type === ModelType.speech2text)
        mutateSpeech2textDefaultModel()
      if (type === ModelType.reranking)
        mutateRerankDefaultModel()
    })
  }
  const handleChangeDefaultModel = async (type: ModelType, v: BackendModel) => {
    setSelectedModel({
      ...selectedModel,
      [type]: {
        providerName: v.model_provider.provider_name,
        modelName: v.model_name,
      },
    })
  }
  const handleSave = async () => {
    const kesArray = Object.keys(selectedModel) as ModelType[]
    const res = await updateDefaultModel({
      url: '/workspaces/current/default-model',
      body: {
        model_settings: kesArray.map((key) => {
          return {
            model_type: key,
            provider_name: selectedModel?.[key]?.providerName,
            model_name: selectedModel?.[key]?.modelName,
          }
        }),
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      mutateDefaultModel(kesArray)
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
          flex items-center px-2 h-6 text-xs text-gray-700 cursor-pointer rounded-md border-[0.5px] border-gray-200 shadow-xs
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
                value={selectedModel[ModelType.textGeneration]}
                modelType={ModelType.textGeneration}
                onChange={v => handleChangeDefaultModel(ModelType.textGeneration, v)}
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
                value={selectedModel[ModelType.embeddings]}
                modelType={ModelType.embeddings}
                onChange={v => handleChangeDefaultModel(ModelType.embeddings, v)}
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
                value={selectedModel[ModelType.reranking]}
                modelType={ModelType.reranking}
                onChange={v => handleChangeDefaultModel(ModelType.reranking, v)}
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
                value={selectedModel[ModelType.speech2text]}
                modelType={ModelType.speech2text}
                onChange={v => handleChangeDefaultModel(ModelType.speech2text, v)}
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
