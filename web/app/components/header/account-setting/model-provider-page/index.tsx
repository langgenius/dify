import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAlertFill } from '@remixicon/react'
import SystemModelSelector from './system-model-selector'
import ProviderAddedCard, { UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST } from './provider-added-card'
import ProviderCard from './provider-card'
import type {
  CustomConfigurationModelFixedFields,
  ModelProvider,
} from './declarations'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
} from './declarations'
import {
  useDefaultModel,
  useUpdateModelList,
  useUpdateModelProviders,
} from './hooks'
import { useProviderContext } from '@/context/provider-context'
import { useModalContextSelector } from '@/context/modal-context'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import cn from '@/utils/classnames'

const ModelProviderPage = () => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const { data: textGenerationDefaultModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { data: embeddingsDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)
  const { data: rerankDefaultModel } = useDefaultModel(ModelTypeEnum.rerank)
  const { data: speech2textDefaultModel } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: ttsDefaultModel } = useDefaultModel(ModelTypeEnum.tts)
  const { modelProviders: providers } = useProviderContext()
  const setShowModelModal = useModalContextSelector(state => state.setShowModelModal)
  const defaultModelNotConfigured = !textGenerationDefaultModel && !embeddingsDefaultModel && !speech2textDefaultModel && !rerankDefaultModel && !ttsDefaultModel
  const [configuredProviders, notConfiguredProviders] = useMemo(() => {
    const configuredProviders: ModelProvider[] = []
    const notConfiguredProviders: ModelProvider[] = []

    providers.forEach((provider) => {
      if (
        provider.custom_configuration.status === CustomConfigurationStatusEnum.active
        || (
          provider.system_configuration.enabled === true
          && provider.system_configuration.quota_configurations.find(item => item.quota_type === provider.system_configuration.current_quota_type)
        )
      )
        configuredProviders.push(provider)
      else
        notConfiguredProviders.push(provider)
    })

    return [configuredProviders, notConfiguredProviders]
  }, [providers])

  const handleOpenModal = (
    provider: ModelProvider,
    configurateMethod: ConfigurationMethodEnum,
    CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  ) => {
    setShowModelModal({
      payload: {
        currentProvider: provider,
        currentConfigurationMethod: configurateMethod,
        currentCustomConfigurationModelFixedFields: CustomConfigurationModelFixedFields,
      },
      onSaveCallback: () => {
        updateModelProviders()

        if (configurateMethod === ConfigurationMethodEnum.predefinedModel) {
          provider.supported_model_types.forEach((type) => {
            updateModelList(type)
          })
        }

        if (configurateMethod === ConfigurationMethodEnum.customizableModel && provider.custom_configuration.status === CustomConfigurationStatusEnum.active) {
          eventEmitter?.emit({
            type: UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST,
            payload: provider.provider,
          } as any)

          if (CustomConfigurationModelFixedFields?.__model_type)
            updateModelList(CustomConfigurationModelFixedFields?.__model_type)
        }
      },
    })
  }

  return (
    <div className='relative pt-1 -mt-2'>
      <div className={cn('flex items-center mb-2')}>
        <div className='grow text-text-primary system-md-semibold'>{t('common.modelProvider.models')}</div>
        <div className={cn(
          'shrink-0 relative flex items-center justify-end gap-2 p-0.5 rounded-lg border border-transparent',
          defaultModelNotConfigured && 'pl-2 bg-components-panel-bg-blur border-components-panel-border shadow-xs',
        )}>
          {defaultModelNotConfigured && <div className='absolute top-0 bottom-0 right-0 left-0 opacity-40' style={{ background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)' }}/>}
          {defaultModelNotConfigured && (
            <div className='flex items-center gap-1 text-text-primary system-xs-medium'>
              <RiAlertFill className='w-4 h-4 text-text-warning-secondary' />
              {t('common.modelProvider.notConfigured')}
            </div>
          )}
          <SystemModelSelector
            notConfigured={defaultModelNotConfigured}
            textGenerationDefaultModel={textGenerationDefaultModel}
            embeddingsDefaultModel={embeddingsDefaultModel}
            rerankDefaultModel={rerankDefaultModel}
            speech2textDefaultModel={speech2textDefaultModel}
            ttsDefaultModel={ttsDefaultModel}
          />
        </div>
      </div>
      {
        !!configuredProviders?.length && (
          <div className='pb-3'>
            {
              configuredProviders?.map(provider => (
                <ProviderAddedCard
                  key={provider.provider}
                  provider={provider}
                  onOpenModal={(configurateMethod: ConfigurationMethodEnum, currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields) => handleOpenModal(provider, configurateMethod, currentCustomConfigurationModelFixedFields)}
                />
              ))
            }
          </div>
        )
      }
      {
        !!notConfiguredProviders?.length && (
          <>
            <div className='flex items-center mb-2 text-xs font-semibold text-gray-500'>
              + {t('common.modelProvider.addMoreModelProvider')}
              <span className='grow ml-3 h-[1px] bg-gradient-to-r from-[#f3f4f6]' />
            </div>
            <div className='grid grid-cols-3 gap-2'>
              {
                notConfiguredProviders?.map(provider => (
                  <ProviderCard
                    key={provider.provider}
                    provider={provider}
                    onOpenModal={(configurateMethod: ConfigurationMethodEnum) => handleOpenModal(provider, configurateMethod)}
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
