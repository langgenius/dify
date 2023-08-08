import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelModal as TModelModal } from './declarations'
import ModelSelector from './model-selector'
import ModelCard from './model-card'
import ModelItem from './model-item'
import ModelModal from './model-modal'
import config from './configs'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'

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
  const [showMoreModel, setShowMoreModel] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [modelModalConfig, setModelModalConfig] = useState<TModelModal | undefined>(undefined)

  const handleOpenModal = (newModelModalConfig?: TModelModal) => {
    setShowModal(true)
    setModelModalConfig(newModelModalConfig)
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
          MODEL_CARD_LIST.map(model => (
            <ModelCard
              key={model.key}
              modelItem={model.item}
              onOpenModal={() => handleOpenModal(model.modal)}
            />
          ))
        }
      </div>
      {
        MODEL_LIST.slice(0, showMoreModel ? MODEL_LIST.length : 3).map(model => (
          <ModelItem
            key={model.key}
            modelItem={model.item}
            onOpenModal={() => handleOpenModal(model.modal)}
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
        onCancel={() => setShowModal(false)}
      />
    </div>
  )
}

export default ModelPage
