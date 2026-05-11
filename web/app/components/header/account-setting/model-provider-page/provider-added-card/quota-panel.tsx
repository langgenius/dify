import type { FC } from 'react'
import type { ModelProvider } from '../declarations'
import type { Plugin } from '@/app/components/plugins/types'
import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import Loading from '@/app/components/base/loading'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import useTimestamp from '@/hooks/use-timestamp'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { formatNumber } from '@/utils/format'
import { PreferredProviderTypeEnum } from '../declarations'
import { useMarketplaceAllPlugins } from '../hooks'
import { MODEL_PROVIDER_QUOTA_GET_PAID, modelNameMap, providerIconMap, providerKeyToPluginId } from '../utils'
import styles from './quota-panel.module.css'
import { useTrialCredits } from './use-trial-credits'

const allProviders = MODEL_PROVIDER_QUOTA_GET_PAID.map(key => ({
  key,
  Icon: providerIconMap[key],
}))

type QuotaPanelProps = {
  providers: ModelProvider[]
}
const QuotaPanel: FC<QuotaPanelProps> = ({
  providers,
}) => {
  const { t } = useTranslation()
  const { credits, isExhausted, isLoading, nextCreditResetDate } = useTrialCredits()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const trialModels = systemFeatures.trial_models
  const providerMap = useMemo(() => new Map(
    providers.map(p => [p.provider, p.preferred_provider_type]),
  ), [providers])
  const installedProvidersMap = useMemo(() => new Map(
    providers.map(p => [p.provider, p.custom_configuration.available_credentials]),
  ), [providers])
  const { formatTime } = useTimestamp()
  const {
    plugins: allPlugins,
  } = useMarketplaceAllPlugins(providers, '')
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)
  const [isShowInstallModal, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)
  const selectedPluginIdRef = useRef<string | null>(null)

  const handleIconClick = useCallback((key: ModelProviderQuotaGetPaid) => {
    const isInstalled = providerMap.get(key)
    if (!isInstalled && allPlugins) {
      const pluginId = providerKeyToPluginId[key]
      const plugin = allPlugins.find(p => p.plugin_id === pluginId)
      if (plugin) {
        setSelectedPlugin(plugin)
        selectedPluginIdRef.current = pluginId
        showInstallFromMarketplace()
      }
    }
  }, [allPlugins, providerMap, showInstallFromMarketplace])

  useEffect(() => {
    if (isShowInstallModal && selectedPluginIdRef.current) {
      const isInstalled = providers.some(p => p.provider.startsWith(selectedPluginIdRef.current!))
      if (isInstalled) {
        hideInstallFromMarketplace()
        selectedPluginIdRef.current = null
      }
    }
  }, [providers, isShowInstallModal, hideInstallFromMarketplace])

  const tipText = t('modelProvider.card.tip', {
    ns: 'common',
    modelNames: trialModels.map(key => modelNameMap[key as keyof typeof modelNameMap]).filter(Boolean).join(', '),
  })

  if (isLoading) {
    return (
      <div className="my-2 flex min-h-[72px] items-center justify-center rounded-xl border-[0.5px] border-components-panel-border bg-third-party-model-bg-default shadow-xs">
        <Loading />
      </div>
    )
  }

  return (
    <div className={cn(
      'relative my-2 min-w-[72px] shrink-0 overflow-hidden rounded-xl border-[0.5px] pt-3 pr-2.5 pb-2.5 pl-4 shadow-xs',
      isExhausted
        ? 'border-state-destructive-border hover:bg-state-destructive-hover'
        : 'border-components-panel-border bg-third-party-model-bg-default',
    )}
    >
      <div className={cn('pointer-events-none absolute inset-0', styles.gridBg)} />
      <div className="relative">
        <div className="mb-2 flex h-4 items-center system-xs-medium-uppercase text-text-tertiary">
          {t('modelProvider.quota', { ns: 'common' })}
          <Infotip aria-label={tipText} className="ml-0.5">
            {tipText}
          </Infotip>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-text-tertiary">
            {credits > 0
              ? <span className="mr-0.5 system-xl-semibold text-text-secondary">{formatNumber(credits)}</span>
              : <span className="mr-0.5 system-xl-semibold text-text-destructive">{t('modelProvider.card.quotaExhausted', { ns: 'common' })}</span>}
            {nextCreditResetDate
              ? (
                  <>
                    <span>·</span>
                    <span>
                      {t('modelProvider.resetDate', {
                        ns: 'common',
                        date: formatTime(nextCreditResetDate, t('dateFormat', { ns: 'appLog' })),
                        interpolation: { escapeValue: false },
                      })}
                    </span>
                  </>
                )
              : null}
          </div>
          <div className="flex items-center gap-1">
            {allProviders.filter(({ key }) => trialModels.includes(key)).map(({ key, Icon }) => {
              const providerType = providerMap.get(key)
              const isConfigured = (installedProvidersMap.get(key)?.length ?? 0) > 0
              const getTooltipKey = () => {
                if (!providerType)
                  return 'modelProvider.card.modelNotSupported'
                if (isConfigured && providerType === PreferredProviderTypeEnum.custom)
                  return 'modelProvider.card.modelAPI'
                return 'modelProvider.card.modelSupported'
              }
              const tooltipText = t(getTooltipKey(), { modelName: modelNameMap[key], ns: 'common' })
              return (
                <Tooltip key={key}>
                  <TooltipTrigger
                    aria-label={tooltipText}
                    render={(
                      <div
                        className={cn('relative h-6 w-6', !providerType && 'cursor-pointer hover:opacity-80')}
                        onClick={() => handleIconClick(key)}
                      >
                        <Icon className="h-6 w-6 rounded-lg" />
                        {!providerType && (
                          <div className="absolute inset-0 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge opacity-30" />
                        )}
                      </div>
                    )}
                  />
                  <TooltipContent>
                    {tooltipText}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>
      </div>
      {isShowInstallModal && selectedPlugin && (
        <InstallFromMarketplace
          manifest={selectedPlugin}
          uniqueIdentifier={selectedPlugin.latest_package_identifier}
          onClose={hideInstallFromMarketplace}
          onSuccess={hideInstallFromMarketplace}
        />
      )}
    </div>
  )
}

export default React.memo(QuotaPanel)
