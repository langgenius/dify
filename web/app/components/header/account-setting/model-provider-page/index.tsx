import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SystemModelSelector from './system-model-selector'
import ProviderAddedCard, { UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST } from './provider-added-card'
import ProviderCard from './provider-card'
import type {
  CustomConfigrationModelFixedFields,
  ModelProvider,
} from './declarations'
import {
  ConfigurateMethodEnum,
  CustomConfigurationStatusEnum,
} from './declarations'
import {
  useDefaultModel,
  useUpdateModelList,
  useUpdateModelProviders,
} from './hooks'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'
import { useEventEmitterContextContext } from '@/context/event-emitter'

const ModelProviderPage = () => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const { data: textGenerationDefaultModel } = useDefaultModel(1)
  const { data: embeddingsDefaultModel } = useDefaultModel(2)
  const { data: rerankDefaultModel } = useDefaultModel(3)
  const { data: speech2textDefaultModel } = useDefaultModel(4)
  const { data: ttsDefaultModel } = useDefaultModel(5)
  const { modelProviders: providers } = useProviderContext()
  const { setShowModelModal } = useModalContext()
  const defaultModelNotConfigured = !textGenerationDefaultModel && !embeddingsDefaultModel && !speech2textDefaultModel && !rerankDefaultModel && !ttsDefaultModel
  const [configedProviders, notConfigedProviders] = useMemo(() => {
    const configedProviders: ModelProvider[] = []
    const notConfigedProviders: ModelProvider[] = []

    providers.forEach((provider) => {
      if (
        provider.custom_configuration.status === CustomConfigurationStatusEnum.active
        || (
          provider.system_configuration.enabled === true
          && provider.system_configuration.quota_configurations.find(item => item.quota_type === provider.system_configuration.current_quota_type)
        )
      )
        configedProviders.push(provider)
      else
        notConfigedProviders.push(provider)
    })

    return [configedProviders, notConfigedProviders]
  }, [providers])

  const handleOpenModal = (
    provider: ModelProvider,
    configurateMethod: ConfigurateMethodEnum,
    customConfigrationModelFixedFields?: CustomConfigrationModelFixedFields,
  ) => {
    setShowModelModal({
      payload: {
        currentProvider: provider,
        currentConfigurateMethod: configurateMethod,
        currentCustomConfigrationModelFixedFields: customConfigrationModelFixedFields,
      },
      onSaveCallback: () => {
        updateModelProviders()

        if (configurateMethod === ConfigurateMethodEnum.predefinedModel) {
          provider.supported_model_types.forEach((type) => {
            updateModelList(type)
          })
        }

        if (configurateMethod === ConfigurateMethodEnum.customizableModel && provider.custom_configuration.status === CustomConfigurationStatusEnum.active) {
          eventEmitter?.emit({
            type: UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST,
            payload: provider.provider,
          } as any)

          if (customConfigrationModelFixedFields?.__model_type)
            updateModelList(customConfigrationModelFixedFields?.__model_type)
        }
      },
    })
  }

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
        <SystemModelSelector
          textGenerationDefaultModel={textGenerationDefaultModel}
          embeddingsDefaultModel={embeddingsDefaultModel}
          rerankDefaultModel={rerankDefaultModel}
          speech2textDefaultModel={speech2textDefaultModel}
          ttsDefaultModel={ttsDefaultModel}
        />
      </div>
      {
        !!configedProviders?.length && (
          <div className='pb-3'>
            {
              configedProviders?.map(provider => (
                <ProviderAddedCard
                  key={provider.provider}
                  provider={provider}
                  onOpenModal={(configurateMethod: ConfigurateMethodEnum, currentCustomConfigrationModelFixedFields?: CustomConfigrationModelFixedFields) => handleOpenModal(provider, configurateMethod, currentCustomConfigrationModelFixedFields)}
                />
              ))
            }
          </div>
        )
      }
      {
        !!notConfigedProviders?.length && (
          <>
            <div className='flex items-center mb-2 text-xs font-semibold text-gray-500'>
              + {t('common.modelProvider.addMoreModelProvider')}
              <span className='grow ml-3 h-[1px] bg-gradient-to-r from-[#f3f4f6]' />
            </div>
            <div className='grid grid-cols-3 gap-2'>
              {
                notConfigedProviders?.map(provider => (
                  <ProviderCard
                    key={provider.provider}
                    provider={provider}
                    onOpenModal={(configurateMethod: ConfigurateMethodEnum) => handleOpenModal(provider, configurateMethod)}
                  />
                ))
              }
            </div>
          </>
        )
      }
    </div>
  )
}

export default ModelProviderPage
