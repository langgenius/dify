import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import SystemModelSelector from './system-model-selector'
import ProviderAddedCard from './provider-added-card'
import ProviderCard from './provider-card'
import ModelModal from './model-modal'
import type {
  ConfigurateMethodEnum,
  CustomConfigrationModelFixedFields,
  ModelProvider,
} from './declarations'
import { CustomConfigurationStatusEnum } from './declarations'
import {
  useDefaultModel,
  useUpdateModelList,
} from './hooks'
import { fetchModelProviders } from '@/service/common'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Loading from '@/app/components/base/loading'

const ModelProviderPage = () => {
  const { t } = useTranslation()
  const updateModelList = useUpdateModelList()
  const { data: textGenerationDefaultModel } = useDefaultModel(1)
  const { data: embeddingsDefaultModel } = useDefaultModel(2)
  const { data: rerankDefaultModel } = useDefaultModel(3)
  const { data: speech2textDefaultModel } = useDefaultModel(4)
  const [currentProvider, setCurrentProvider] = useState<ModelProvider | null>(null)
  const [currentConfigurateMethod, setCurrentConfigurateMethod] = useState<ConfigurateMethodEnum | null>(null)
  const [currentCustomConfigrationModelFixedFields, setCurrentCustomConfigrationModelFixedFields] = useState<CustomConfigrationModelFixedFields | undefined>(undefined)
  const { data: providersData, mutate: mutateProviders, isLoading } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const defaultModelNotConfigured = !textGenerationDefaultModel && !embeddingsDefaultModel && !speech2textDefaultModel && !rerankDefaultModel
  const providers = useMemo(() => {
    return providersData ? providersData.data : []
  }, [providersData])
  const [configedProviders, notConfigedProviders] = useMemo(() => {
    const configedProviders: ModelProvider[] = []
    const notConfigedProviders: ModelProvider[] = []

    providers.forEach((provider) => {
      if (provider.custom_configuration.status === CustomConfigurationStatusEnum.active || provider.system_configuration.enabled === true)
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
    setCurrentProvider(provider)
    setCurrentConfigurateMethod(configurateMethod)
    setCurrentCustomConfigrationModelFixedFields(customConfigrationModelFixedFields)
  }

  const handleCancelModelModal = () => {
    setCurrentProvider(null)
    setCurrentConfigurateMethod(null)
    setCurrentCustomConfigrationModelFixedFields(undefined)
  }

  const handleSaveCrendentials = () => {
    mutateProviders()
    currentProvider?.supported_model_types.forEach((modelType) => {
      updateModelList(modelType)
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
          onUpdate={() => mutateProviders()}
        />
      </div>
      {
        isLoading && (
          <div className='mt-[240px]'>
            <Loading />
          </div>
        )
      }
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
      {
        !!currentProvider && !!currentConfigurateMethod && (
          <ModelModal
            provider={currentProvider}
            configurateMethod={currentConfigurateMethod}
            currentCustomConfigrationModelFixedFields={currentCustomConfigrationModelFixedFields}
            onCancel={handleCancelModelModal}
            onSave={handleSaveCrendentials}
          />
        )
      }
    </div>
  )
}

export default ModelProviderPage
