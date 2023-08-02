import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModelSelector from './model-selector'
import ModelCard from './model-card'
import ModelItem from './model-item'
import ModelModal from './model-modal'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import {
  AzureOpenaiServiceText,
  ChatglmText,
  HuggingfaceText,
  ReplicateText,
} from '@/app/components/base/icons/src/public/llm'
import {
  MinimaxText,
  TongyiText,
} from '@/app/components/base/icons/src/image/llm'

const MODEL_LIST = [
  {
    key: 'azure_openai',
    type: 'add',
    icon: <AzureOpenaiServiceText className='h-6' />,
  },
  {
    key: 'replicate',
    type: 'add',
    icon: <ReplicateText className='h-6' />,
  },
  {
    key: 'huggingface_hub',
    type: 'add',
    icon: <HuggingfaceText className='h-6' />,
  },
  {
    key: 'tongyi',
    type: 'setup',
    icon: <TongyiText className='w-[88px] h-6' />,
  },
  {
    key: 'minimax',
    type: 'setup',
    icon: <MinimaxText className='w-[84px] h-6' />,
  },
  {
    key: 'chatglm',
    type: 'setup',
    icon: <ChatglmText className='h-6' />,
  },
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
  const [modelModalShow, setModelModalShow] = useState(false)

  return (
    <div className='pt-1'>
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
        <ModelCard onOpenModal={() => {}} />
        <ModelCard onOpenModal={() => {}} type='anthropic' />
      </div>
      {
        MODEL_LIST.slice(0, showMoreModel ? MODEL_LIST.length : 3).map(model => (
          <ModelItem
            key={model.key}
            provider={model}
            onOperate={() => setModelModalShow(true)}
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
        isShow={modelModalShow}
        onCancel={() => setModelModalShow(false)}
      />
    </div>
  )
}

export default ModelPage
