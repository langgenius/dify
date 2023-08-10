import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import type {
  FormValue,
  ModelModal as TModelModal,
} from './declarations'
import { ModelEnum } from './declarations'
import ModelSelector from './model-selector'
import ModelCard from './model-card'
import ModelItem from './model-item'
import ModelModal from './model-modal'
import config from './configs'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import { fetchModelProviders, setModelProvider } from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'

const MODEL_CARD_LIST = [
  config.openai,
  config.anthropic,
]

const MODEL_LIST = [
  config.azure_openai,
  config.replicate,
  config.huggingface_hub,
  config.tongyi,
  config.spark,
  config.minimax,
  config.chatglm,
]

const titleClassName = `
flex items-center h-9 text-sm font-medium text-gray-900
`
const tipClassName = `
ml-0.5 w-[14px] h-[14px] text-gray-400
`

const ModelPage = () => {
  const { t } = useTranslation()
  const { data: providers, mutate: mutateProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  console.log(providers)
  const [showMoreModel, setShowMoreModel] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const { notify } = useToastContext()
  const [modelModalConfig, setModelModalConfig] = useState<TModelModal | undefined>(undefined)

  const handleOpenModal = (newModelModalConfig: TModelModal | undefined, editValue?: FormValue) => {
    if (newModelModalConfig) {
      setShowModal(true)
      const defaultValue = editValue ? { ...newModelModalConfig.defaultValue, ...editValue } : newModelModalConfig.defaultValue
      setModelModalConfig({ ...newModelModalConfig, defaultValue })
    }
  }
  const handleCancelModal = () => {
    setShowModal(false)
  }
  const handleSave = async (v?: FormValue) => {
    if (modelModalConfig && v && [ModelEnum.azure_openai, ModelEnum.replicate, ModelEnum.huggingface_hub].includes(modelModalConfig?.key)) {
      const { model_name, model_type, ...config } = v
      const res = await setModelProvider({
        url: `/workspaces/current/model-providers/${modelModalConfig?.key}/models`,
        body: {
          model_name,
          model_type,
          config,
        },
      })
      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        mutateProviders()
        handleCancelModal()
      }
      return
    }
    const res = await setModelProvider({
      url: `/workspaces/current/model-providers/${modelModalConfig?.key}`,
      body: {
        config: v,
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      mutateProviders()
      handleCancelModal()
    }
  }

  return (
    <div className='pt-1 -mt-2'>
      <div className='grid grid-cols-3 gap-4 mb-5'>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.systemReasoningModel.key')}
            <HelpCircle className={tipClassName} />
          </div>
          <div>
            <ModelSelector />
          </div>
        </div>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.embeddingModel.key')}
            <HelpCircle className={tipClassName} />
          </div>
          <div>
            <ModelSelector />
          </div>
        </div>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.speechToTextModel.key')}
            <HelpCircle className={tipClassName} />
          </div>
          <div>
            <ModelSelector />
          </div>
        </div>
      </div>
      <div className='mb-5 h-[0.5px] bg-gray-100' />
      <div className='mb-3 text-sm font-medium text-gray-800'>{t('common.modelProvider.models')}</div>
      <div className='grid grid-cols-2 gap-4 mb-6'>
        {
          MODEL_CARD_LIST.map((model, index) => (
            <ModelCard
              key={index}
              modelItem={model.item}
              currentProvider={providers?.[model.item.key]}
              onOpenModal={editValud => handleOpenModal(model.modal, editValud)}
              onUpdate={mutateProviders}
            />
          ))
        }
      </div>
      {
        MODEL_LIST.slice(0, showMoreModel ? MODEL_LIST.length : 3).map((model, index) => (
          <ModelItem
            key={index}
            modelItem={model.item}
            currentProvider={providers?.[model.item.key]}
            onOpenModal={() => handleOpenModal(model.modal)}
            onUpdate={mutateProviders}
          />
        ))
      }
      {
        !showMoreModel && (
          <div className='inline-flex items-center px-1 h-[26px] cursor-pointer' onClick={() => setShowMoreModel(true)}>
            <ChevronDownDouble className='mr-1 w-3 h-3 text-gray-500' />
            <div className='text-xs font-medium text-gray-500'>{t('common.modelProvider.showMoreModelProvider')}</div>
          </div>
        )
      }
      <ModelModal
        isShow={showModal}
        modelModal={modelModalConfig}
        onCancel={handleCancelModal}
        onSave={handleSave}
      />
    </div>
  )
}

export default ModelPage
