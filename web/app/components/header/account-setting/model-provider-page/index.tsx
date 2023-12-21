import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import SystemModelSelector from './system-model-selector'
import ProviderAddedCard from './provider-added-card'
import ProviderCard from './provider-card'
import ModelModal from './model-modal'
import type {
  ConfigurateMethodEnum,
  ModelProvider,
} from './declarations'
import { CustomConfigurationStatusEnum } from './declarations'
import { fetchModelProviders } from '@/service/common'
import { useProviderContext } from '@/context/provider-context'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'

const ModelProviderPage = () => {
  const { t } = useTranslation()
  const {
    textGenerationDefaultModel,
    embeddingsDefaultModel,
    speech2textDefaultModel,
    rerankDefaultModel,
  } = useProviderContext()
  const [currentProvider, setCurrentProvider] = useState<ModelProvider | null>(null)
  const [currentConfigurateMethod, setCurrentConfigurateMethod] = useState<ConfigurateMethodEnum | null>(null)
  const { data: providersData, mutate: mutateProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
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

  const handleOpenModal = (provider: ModelProvider, configurateMethod: ConfigurateMethodEnum) => {
    setCurrentProvider(provider)
    setCurrentConfigurateMethod(configurateMethod)
  }

  const handleCancelModelModal = () => {
    setCurrentProvider(null)
    setCurrentConfigurateMethod(null)
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
        <SystemModelSelector onUpdate={() => mutateProviders()} />
      </div>
      {
        !!configedProviders?.length && (
          <div className='pb-3'>
            {
              configedProviders?.map(provider => (
                <ProviderAddedCard
                  key={provider.provider}
                  provider={provider}
                  onOpenModal={(configurateMethod: ConfigurateMethodEnum) => handleOpenModal(provider, configurateMethod)}
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
              + ADD MORE MODEL PROVIDER
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
            onCancel={handleCancelModelModal}
            onSave={() => mutateProviders()}
          />
        )
      }
    </div>
  )
}

export default ModelProviderPage
