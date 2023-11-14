import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import ModelSelector from '../model-selector'
import type {
  BackendModel,
} from '../declarations'
import Tooltip from '@/app/components/base/tooltip'
import { HelpCircle, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useProviderContext } from '@/context/provider-context'
import {
  fetchDefaultModal,
  updateDefaultModel,
} from '@/service/common'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import { useToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'

const SystemModel = () => {
  const { t } = useTranslation()
  const {
    embeddingsDefaultModel,
    mutateEmbeddingsDefaultModel,
    speech2textDefaultModel,
    mutateSpeech2textDefaultModel,
  } = useProviderContext()
  const { notify } = useToastContext()
  const [open, setOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<BackendModel | undefined>(undefined)
  const { data: textGenerationDefaultModel, mutate: mutateTextGenerationDefaultModel } = useSWR('/workspaces/current/default-model?model_type=text-generation', fetchDefaultModal)

  const mutateDefaultModel = (type: ModelType) => {
    if (type === ModelType.textGeneration)
      mutateTextGenerationDefaultModel()
    if (type === ModelType.embeddings)
      mutateEmbeddingsDefaultModel()
    if (type === ModelType.speech2text)
      mutateSpeech2textDefaultModel()
  }
  const handleChangeDefaultModel = async (type: ModelType, v: BackendModel) => {
    const res = await updateDefaultModel({
      url: '/workspaces/current/default-model',
      body: {
        model_type: type,
        provider_name: v.model_provider.provider_name,
        model_name: v.model_name,
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      mutateDefaultModel(type)
    }
  }
  const handleSave = () => {

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
          System Model Settings
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
                value={textGenerationDefaultModel && { providerName: textGenerationDefaultModel.model_provider.provider_name, modelName: textGenerationDefaultModel.model_name }}
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
                value={embeddingsDefaultModel && { providerName: embeddingsDefaultModel.model_provider.provider_name, modelName: embeddingsDefaultModel.model_name }}
                modelType={ModelType.embeddings}
                onChange={v => handleChangeDefaultModel(ModelType.embeddings, v)}
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
                value={speech2textDefaultModel && { providerName: speech2textDefaultModel.model_provider.provider_name, modelName: speech2textDefaultModel.model_name }}
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
          <div className='flex items-center justify-center h-[42px] bg-gray-50 text-xs text-gray-500 border-t-[0.5px] border-t-black/5 rounded-b-xl'>
            Why is it necessary to set up a system model?
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SystemModel
