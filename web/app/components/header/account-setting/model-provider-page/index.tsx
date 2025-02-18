import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useDebounce } from 'ahooks'
import {
  RiAlertFill,
  RiArrowDownSLine,
  RiArrowRightUpLine,
  RiBrainLine,
} from '@remixicon/react'
import SystemModelSelector from './system-model-selector'
import ProviderAddedCard from './provider-added-card'
import type {
  ConfigurationMethodEnum,
  CustomConfigurationModelFixedFields,

  ModelProvider,
} from './declarations'
import {
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
} from './declarations'
import {
  useDefaultModel,
  useMarketplaceAllPlugins,
  useModelModalHandler,
} from './hooks'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import ProviderCard from '@/app/components/plugins/provider-card'
import List from '@/app/components/plugins/marketplace/list'
import { useProviderContext } from '@/context/provider-context'
import type { Plugin } from '@/app/components/plugins/types'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import cn from '@/utils/classnames'
import { getLocaleOnClient } from '@/i18n'

type Props = {
  searchText: string
}

const ModelProviderPage = ({ searchText }: Props) => {
  const debouncedSearchText = useDebounce(searchText, { wait: 500 })
  const { t } = useTranslation()
  const { data: textGenerationDefaultModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { data: embeddingsDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)
  const { data: rerankDefaultModel } = useDefaultModel(ModelTypeEnum.rerank)
  const { data: speech2textDefaultModel } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: ttsDefaultModel } = useDefaultModel(ModelTypeEnum.tts)
  const { modelProviders: providers } = useProviderContext()
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
  const [filteredConfiguredProviders, filteredNotConfiguredProviders] = useMemo(() => {
    const filteredConfiguredProviders = configuredProviders.filter(
      provider => provider.provider.toLowerCase().includes(debouncedSearchText.toLowerCase())
        || Object.values(provider.label).some(text => text.toLowerCase().includes(debouncedSearchText.toLowerCase())),
    )
    const filteredNotConfiguredProviders = notConfiguredProviders.filter(
      provider => provider.provider.toLowerCase().includes(debouncedSearchText.toLowerCase())
        || Object.values(provider.label).some(text => text.toLowerCase().includes(debouncedSearchText.toLowerCase())),
    )

    return [filteredConfiguredProviders, filteredNotConfiguredProviders]
  }, [configuredProviders, debouncedSearchText, notConfiguredProviders])

  const handleOpenModal = useModelModalHandler()
  const [collapse, setCollapse] = useState(false)
  const locale = getLocaleOnClient()
  const {
    plugins: allPlugins,
    isLoading: isAllPluginsLoading,
  } = useMarketplaceAllPlugins(providers, searchText)

  const cardRender = useCallback((plugin: Plugin) => {
    if (plugin.type === 'bundle')
      return null

    return <ProviderCard key={plugin.plugin_id} payload={plugin} />
  }, [])

  return (
    <div className='relative -mt-2 pt-1'>
      <div className={cn('mb-2 flex items-center')}>
        <div className='text-text-primary system-md-semibold grow'>{t('common.modelProvider.models')}</div>
        <div className={cn(
          'relative flex shrink-0 items-center justify-end gap-2 rounded-lg border border-transparent p-px',
          defaultModelNotConfigured && 'bg-components-panel-bg-blur border-components-panel-border shadow-xs pl-2',
        )}>
          {defaultModelNotConfigured && <div className='absolute bottom-0 left-0 right-0 top-0 opacity-40' style={{ background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)' }} />}
          {defaultModelNotConfigured && (
            <div className='text-text-primary system-xs-medium flex items-center gap-1'>
              <RiAlertFill className='text-text-warning-secondary h-4 w-4' />
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
      {!filteredConfiguredProviders?.length && (
        <div className='bg-workflow-process-bg mb-2 rounded-[10px] p-4'>
          <div className='border-components-card-border bg-components-card-bg flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] shadow-lg backdrop-blur'>
            <RiBrainLine className='text-text-primary h-5 w-5' />
          </div>
          <div className='text-text-secondary system-sm-medium mt-2'>{t('common.modelProvider.emptyProviderTitle')}</div>
          <div className='text-text-tertiary system-xs-regular mt-1'>{t('common.modelProvider.emptyProviderTip')}</div>
        </div>
      )}
      {!!filteredConfiguredProviders?.length && (
        <div className='relative'>
          {filteredConfiguredProviders?.map(provider => (
            <ProviderAddedCard
              key={provider.provider}
              provider={provider}
              onOpenModal={(configurationMethod: ConfigurationMethodEnum, currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields) => handleOpenModal(provider, configurationMethod, currentCustomConfigurationModelFixedFields)}
            />
          ))}
        </div>
      )}
      {!!filteredNotConfiguredProviders?.length && (
        <>
          <div className='text-text-primary system-md-semibold mb-2 flex items-center pt-2'>{t('common.modelProvider.toBeConfigured')}</div>
          <div className='relative'>
            {filteredNotConfiguredProviders?.map(provider => (
              <ProviderAddedCard
                notConfigured
                key={provider.provider}
                provider={provider}
                onOpenModal={(configurationMethod: ConfigurationMethodEnum, currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields) => handleOpenModal(provider, configurationMethod, currentCustomConfigurationModelFixedFields)}
              />
            ))}
          </div>
        </>
      )}
      <div className='mb-2'>
        <Divider className='!mt-4 h-px' />
        <div className='flex items-center justify-between'>
          <div className='text-text-primary system-md-semibold flex cursor-pointer items-center gap-1' onClick={() => setCollapse(!collapse)}>
            <RiArrowDownSLine className={cn('h-4 w-4', collapse && '-rotate-90')} />
            {t('common.modelProvider.installProvider')}
          </div>
          <div className='mb-2 flex items-center pt-2'>
            <span className='text-text-tertiary system-sm-regular pr-1'>{t('common.modelProvider.discoverMore')}</span>
            <Link target="_blank" href={`${MARKETPLACE_URL_PREFIX}`} className='system-sm-medium text-text-accent inline-flex items-center'>
              {t('plugin.marketplace.difyMarketplace')}
              <RiArrowRightUpLine className='h-4 w-4' />
            </Link>
          </div>
        </div>
        {!collapse && isAllPluginsLoading && <Loading type='area' />}
        {
          !isAllPluginsLoading && !collapse && (
            <List
              marketplaceCollections={[]}
              marketplaceCollectionPluginsMap={{}}
              plugins={allPlugins}
              showInstallButton
              locale={locale}
              cardContainerClassName='grid grid-cols-2 gap-2'
              cardRender={cardRender}
              emptyClassName='h-auto'
            />
          )
        }
      </div>
    </div>
  )
}

export default ModelProviderPage
