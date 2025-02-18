import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  RiInformation2Fill,
  RiLoader2Line,
} from '@remixicon/react'
import type {
  CustomConfigurationModelFixedFields,
  ModelItem,
  ModelProvider,
} from '../declarations'
import { ConfigurationMethodEnum } from '../declarations'
import {
  MODEL_PROVIDER_QUOTA_GET_PAID,
  modelTypeFormat,
} from '../utils'
import ProviderIcon from '../provider-icon'
import ModelBadge from '../model-badge'
import CredentialPanel from './credential-panel'
import QuotaPanel from './quota-panel'
import ModelList from './model-list'
import AddModelButton from './add-model-button'
import { fetchModelProviderModelList } from '@/service/common'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { IS_CE_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import cn from '@/utils/classnames'

export const UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST = 'UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST'
type ProviderAddedCardProps = {
  notConfigured?: boolean
  provider: ModelProvider
  onOpenModal: (configurationMethod: ConfigurationMethodEnum, currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields) => void
}
const ProviderAddedCard: FC<ProviderAddedCardProps> = ({
  notConfigured,
  provider,
  onOpenModal,
}) => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()
  const [fetched, setFetched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const [modelList, setModelList] = useState<ModelItem[]>([])
  const configurationMethods = provider.configurate_methods.filter(method => method !== ConfigurationMethodEnum.fetchFromRemote)
  const systemConfig = provider.system_configuration
  const hasModelList = fetched && !!modelList.length
  const { isCurrentWorkspaceManager } = useAppContext()
  const showQuota = systemConfig.enabled && [...MODEL_PROVIDER_QUOTA_GET_PAID].includes(provider.provider) && !IS_CE_EDITION
  const showCredential = configurationMethods.includes(ConfigurationMethodEnum.predefinedModel) && isCurrentWorkspaceManager

  const getModelList = async (providerName: string) => {
    if (loading)
      return
    try {
      setLoading(true)
      const modelsData = await fetchModelProviderModelList(`/workspaces/current/model-providers/${providerName}/models`)
      setModelList(modelsData.data)
      setCollapsed(false)
      setFetched(true)
    }
    finally {
      setLoading(false)
    }
  }
  const handleOpenModelList = () => {
    if (fetched) {
      setCollapsed(false)
      return
    }

    getModelList(provider.provider)
  }

  eventEmitter?.useSubscription((v: any) => {
    if (v?.type === UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST && v.payload === provider.provider)
      getModelList(v.payload)
  })

  return (
    <div
      className={cn(
        'border-divider-regular shadow-xs bg-third-party-model-bg-default mb-2 rounded-xl border-[0.5px]',
        provider.provider === 'langgenius/openai/openai' && 'bg-third-party-model-bg-openai',
        provider.provider === 'langgenius/anthropic/anthropic' && 'bg-third-party-model-bg-anthropic',
      )}
    >
      <div className='flex rounded-t-xl py-2 pl-3 pr-2'>
        <div className='grow px-1 pb-0.5 pt-1'>
          <ProviderIcon
            className='mb-2'
            provider={provider}
          />
          <div className='flex gap-0.5'>
            {
              provider.supported_model_types.map(modelType => (
                <ModelBadge key={modelType}>
                  {modelTypeFormat(modelType)}
                </ModelBadge>
              ))
            }
          </div>
        </div>
        {
          showQuota && (
            <QuotaPanel
              provider={provider}
            />
          )
        }
        {
          showCredential && (
            <CredentialPanel
              onSetup={() => onOpenModal(ConfigurationMethodEnum.predefinedModel)}
              provider={provider}
            />
          )
        }
      </div>
      {
        collapsed && (
          <div className='border-t-divider-subtle text-text-tertiary system-xs-medium group flex items-center justify-between border-t py-1.5 pl-2 pr-[11px]'>
            {(showQuota || !notConfigured) && (
              <>
                <div className='flex h-6 items-center pl-1 pr-1.5 leading-6 group-hover:hidden'>
                  {
                    hasModelList
                      ? t('common.modelProvider.modelsNum', { num: modelList.length })
                      : t('common.modelProvider.showModels')
                  }
                  {!loading && <RiArrowRightSLine className='h-4 w-4' />}
                </div>
                <div
                  className='hover:bg-components-button-ghost-bg-hover hidden h-6 cursor-pointer items-center rounded-lg pl-1 pr-1.5 group-hover:flex'
                  onClick={handleOpenModelList}
                >
                  {
                    hasModelList
                      ? t('common.modelProvider.showModelsNum', { num: modelList.length })
                      : t('common.modelProvider.showModels')
                  }
                  {!loading && <RiArrowRightSLine className='h-4 w-4' />}
                  {
                    loading && (
                      <RiLoader2Line className='ml-0.5 h-3 w-3 animate-spin' />
                    )
                  }
                </div>
              </>
            )}
            {!showQuota && notConfigured && (
              <div className='flex h-6 items-center pl-1 pr-1.5'>
                <RiInformation2Fill className='text-text-accent mr-1 h-4 w-4' />
                <span className='text-text-secondary system-xs-medium'>{t('common.modelProvider.configureTip')}</span>
              </div>
            )}
            {
              configurationMethods.includes(ConfigurationMethodEnum.customizableModel) && isCurrentWorkspaceManager && (
                <AddModelButton
                  onClick={() => onOpenModal(ConfigurationMethodEnum.customizableModel)}
                  className='flex'
                />
              )
            }
          </div>
        )
      }
      {
        !collapsed && (
          <ModelList
            provider={provider}
            models={modelList}
            onCollapse={() => setCollapsed(true)}
            onConfig={currentCustomConfigurationModelFixedFields => onOpenModal(ConfigurationMethodEnum.customizableModel, currentCustomConfigurationModelFixedFields)}
            onChange={(provider: string) => getModelList(provider)}
          />
        )
      }
    </div>
  )
}

export default ProviderAddedCard
