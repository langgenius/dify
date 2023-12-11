import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import SystemModel from '../model-page/system-model'
import ProviderAddedCard from './provider-added-card'
import ProviderCard from './provider-card'
import type { ModelProvider } from './declarations'
import {
  ConfigurateMethodEnum,
  ModelTypeEnum,
} from './declarations'
import { fetchModelProviders } from '@/service/common'
import { useProviderContext } from '@/context/provider-context'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'

const provider: ModelProvider = {
  provider: 'openai',
  label: {
    zh_Hans: 'OpenAI',
    en_US: 'OpenAI',
  },
  icon_small: {
    zh_Hans: '',
    en_US: '',
  },
  icon_large: {
    zh_Hans: '',
    en_US: '',
  },
  background: '#FFF8DC',
  supported_models_types: [
    ModelTypeEnum.textEmbedding,
    ModelTypeEnum.textGeneration,
    ModelTypeEnum.speech2text,
    ModelTypeEnum.rerank,
  ],
  configurate_methods: [
    ConfigurateMethodEnum.predefinedModel,
    ConfigurateMethodEnum.customizableModel,
  ],
}

const ModelProviderPage = () => {
  const { t } = useTranslation()
  const {
    updateModelList,
    textGenerationDefaultModel,
    embeddingsDefaultModel,
    speech2textDefaultModel,
    rerankDefaultModel,
  } = useProviderContext()
  const { data: providers, mutate: mutateProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const defaultModelNotConfigured = !textGenerationDefaultModel && !embeddingsDefaultModel && !speech2textDefaultModel && !rerankDefaultModel

  return (
    <div className='relative pt-1 -mt-2'>
      <div className={`flex items-center justify-between mb-2 h-8 ${defaultModelNotConfigured && 'px-3 bg-[#FFFAEB] rounded-lg border border-[#FEF0C7]'}`}>
        {
          defaultModelNotConfigured
            ? (
              <div className='flex items-center text-xs font-medium text-gray-700'>
                <AlertTriangle className='mr-1 w-3 h-3 text-[#F79009]' />
                {t('common.modelProvider.notConfigured')}
              </div>
            )
            : <div className='text-sm font-medium text-gray-800'>{t('common.modelProvider.models')}</div>
        }
        <SystemModel onUpdate={() => mutateProviders()} />
      </div>
      <div className='pb-3'>
        <ProviderAddedCard provider={provider} />
      </div>
      <div className='flex items-center mb-2 text-xs font-semibold text-gray-500'>
        + ADD MORE MODEL PROVIDER
        <span className='grow ml-3 h-[1px] bg-gradient-to-r from-[#f3f4f6]' />
      </div>
      <div className='grid grid-cols-3 gap-2'>
        <ProviderCard provider={provider} />
      </div>
    </div>
  )
}

export default ModelProviderPage
