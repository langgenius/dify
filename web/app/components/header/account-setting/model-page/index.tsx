import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Config } from './declarations'
import ModelSelector from './model-selector'
import ModelCard from './model-card'
import ModelItem from './model-item'
import ModelModal from './model-modal'
import config from './configs'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import {
  Anthropic,
  AnthropicText,
  AzureOpenaiServiceText,
  ChatglmText,
  HuggingfaceText,
  OpenaiBlack,
  OpenaiText,
  ReplicateText,
} from '@/app/components/base/icons/src/public/llm'
import {
  MinimaxText,
  TongyiText,
} from '@/app/components/base/icons/src/image/llm'

const MODEL_CARD_LIST = [
  {
    key: 'openai',
    type: 'add',
    bgColor: 'bg-gray-200',
    iconText: <OpenaiText className='h-5' />,
    icon: <OpenaiBlack className='w-6 h-6' />,
    config: config.openai,
    desc: {
      'en': 'Models provided by OpenAI, such as GPT-3.5-Turbo and GPT-4.',
      'zh-Hans': 'Models provided by OpenAI, such as GPT-3.5-Turbo and GPT-4.',
    },
  },
  {
    key: 'anthropic',
    type: 'add',
    bgColor: 'bg-[#F0F0EB]',
    iconText: <AnthropicText className='h-5' />,
    icon: <Anthropic className='w-6 h-6' />,
    config: config.anthropic,
    desc: {
      'en': 'Anthropic’s powerful models, such as Claude 2 and Claude Instant.',
      'zh-Hans': 'Anthropic’s powerful models, such as Claude 2 and Claude Instant.',
    },
  },
]

const MODEL_LIST = [
  {
    key: 'azure_openai',
    type: 'add',
    icon: <AzureOpenaiServiceText className='h-6' />,
    config: config.azure_openai,
  },
  {
    key: 'replicate',
    type: 'add',
    icon: <ReplicateText className='h-6' />,
    config: config.replicate,
  },
  {
    key: 'huggingface_hub',
    type: 'add',
    icon: <HuggingfaceText className='h-6' />,
    config: config.huggingface_hub,
  },
  {
    key: 'tongyi',
    type: 'setup',
    icon: <TongyiText className='w-[88px] h-6' />,
    config: config.tongyi,
  },
  {
    key: 'minimax',
    type: 'setup',
    icon: <MinimaxText className='w-[84px] h-6' />,
    config: config.minimax,
  },
  {
    key: 'chatglm',
    type: 'setup',
    icon: <ChatglmText className='h-6' />,
    config: config.chatglm,
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
  const [showModal, setShowModal] = useState(false)
  const [modalConfig, setModalConfig] = useState<Config | undefined>(undefined)

  const handleOpenModal = (config?: Config) => {
    setShowModal(true)
    setModalConfig(config)
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
              provider={model}
              onOpenModal={() => handleOpenModal(model.config)}
            />
          ))
        }
      </div>
      {
        MODEL_LIST.slice(0, showMoreModel ? MODEL_LIST.length : 3).map(model => (
          <ModelItem
            key={model.key}
            provider={model}
            onOpenModal={() => handleOpenModal(model.config)}
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
        config={modalConfig}
        onCancel={() => setShowModal(false)}
      />
    </div>
  )
}

export default ModelPage
