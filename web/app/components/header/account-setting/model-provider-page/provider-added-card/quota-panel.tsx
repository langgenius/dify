import type { FC, MouseEvent } from 'react'
import type { ModelProvider } from '../declarations'
import type { Plugin } from '@/app/components/plugins/types'
import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { PluginInstallPermissionProvider } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { IS_CLOUD_EDITION } from '@/config'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'
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

type QuotaInfotipProps = {
  tipText: string
}

const QuotaInfotip: FC<QuotaInfotipProps> = ({ tipText }) => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        aria-label={tipText}
        onClick={handleClick}
        className="ml-0.5 inline-flex size-3 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden"
      >
        <span aria-hidden className="i-ri-information-2-line size-3 text-text-tertiary hover:text-text-secondary" />
      </PopoverTrigger>
      <PopoverContent
        placement="top"
        popupClassName="max-w-[300px] rounded-md px-3 py-2 system-xs-regular text-text-tertiary"
      >
        {tipText}
      </PopoverContent>
    </Popover>
  )
}

type QuotaPanelProps = {
  providers: ModelProvider[]
}
const QuotaPanel: FC<QuotaPanelProps> = ({
  providers,
}) => {
  const { t } = useTranslation()
  const { usedCredits, totalCredits, isExhausted, isLoading, exhaustedAt, nextCreditResetDate } = useTrialCredits()
  const { data: trialModels = [] } = useQuery(consoleQuery.trialModels.get.queryOptions({
    enabled: IS_CLOUD_EDITION,
    select: data => data.trial_models,
  }))
  const providerMap = useMemo(() => new Map(
    providers.map(p => [p.provider, p.preferred_provider_type]),
  ), [providers])
  const installedProvidersMap = useMemo(() => new Map(
    providers.map(p => [p.provider, p.custom_configuration.available_credentials]),
  ), [providers])
  const { formatMonthDay } = useTimestamp()
  const {
    plugins: allPlugins,
  } = useMarketplaceAllPlugins(providers, '')
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)
  const [isShowInstallModal, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)
  const { canInstallPlugin, canUpdatePlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()
  const selectedPluginIdRef = useRef<string | null>(null)

  const handleIconClick = useCallback((key: ModelProviderQuotaGetPaid) => {
    const isInstalled = providerMap.get(key)
    if (!isInstalled && allPlugins && canInstallPlugin) {
      const pluginId = providerKeyToPluginId[key]
      const plugin = allPlugins.find(p => p.plugin_id === pluginId)
      if (plugin) {
        setSelectedPlugin(plugin)
        selectedPluginIdRef.current = pluginId
        showInstallFromMarketplace()
      }
    }
  }, [allPlugins, canInstallPlugin, providerMap, showInstallFromMarketplace])

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
      <div className="flex h-16 items-center justify-center rounded-xl border-[0.5px] border-components-panel-border bg-third-party-model-bg-default shadow-xs">
        <Loading />
      </div>
    )
  }

  const creditUsageTextClassName = isExhausted ? 'text-text-destructive' : 'text-text-secondary'

  return (
    <div className={cn(
      'relative h-16 min-w-[72px] shrink-0 overflow-hidden rounded-xl border-[0.5px] pt-3 pr-2.5 pb-2.5 pl-4 shadow-xs',
      isExhausted
        ? 'border-state-destructive-border hover:bg-state-destructive-hover'
        : 'border-components-panel-border bg-third-party-model-bg-default',
    )}
    >
      <div className={cn('pointer-events-none absolute inset-0', styles.gridBg)} />
      <div className="relative">
        <div className="mb-0.5 flex h-4 items-center system-xs-medium-uppercase text-text-tertiary">
          {t('modelProvider.quotaLabel', { ns: 'common' })}
          <QuotaInfotip tipText={tipText} />
        </div>
        <div className="flex h-6 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="flex shrink-0 items-baseline gap-1">
              <span className={cn('system-xl-semibold', creditUsageTextClassName)}>
                {formatNumber(usedCredits)}
              </span>
              <span className="text-base leading-6 font-normal text-text-tertiary">/</span>
              <span className={cn('system-xl-semibold', creditUsageTextClassName)}>{formatNumber(totalCredits)}</span>
              <span className={cn('system-md-medium', creditUsageTextClassName)}>{t('modelProvider.used', { ns: 'common' })}</span>
            </div>
            {isExhausted && exhaustedAt
              ? (
                  <>
                    <span aria-hidden className="shrink-0 system-sm-regular text-text-tertiary">·</span>
                    <span className="min-w-0 truncate system-sm-regular text-text-tertiary">
                      {t('modelProvider.ranOutDate', {
                        ns: 'common',
                        date: formatMonthDay(exhaustedAt),
                        interpolation: { escapeValue: false },
                      })}
                    </span>
                  </>
                )
              : null}
            {nextCreditResetDate
              ? (
                  <>
                    <span aria-hidden className="shrink-0 system-sm-regular text-text-tertiary">·</span>
                    <span className="min-w-0 truncate system-sm-regular text-text-tertiary">
                      {t('modelProvider.resetDate', {
                        ns: 'common',
                        date: formatMonthDay(nextCreditResetDate),
                        interpolation: { escapeValue: false },
                      })}
                    </span>
                  </>
                )
              : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
                        className={cn('relative size-6', !providerType && canInstallPlugin && 'cursor-pointer hover:opacity-80')}
                        onClick={() => handleIconClick(key)}
                      >
                        <Icon className="size-6 rounded-lg" />
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
      {isShowInstallModal && selectedPlugin && canInstallPlugin && (
        <PluginInstallPermissionProvider
          canInstallPlugin={canInstallPlugin}
          canUpdatePlugin={canUpdatePlugin}
          currentDifyVersion={currentDifyVersion}
        >
          <InstallFromMarketplace
            manifest={selectedPlugin}
            uniqueIdentifier={selectedPlugin.latest_package_identifier}
            onClose={hideInstallFromMarketplace}
            onSuccess={hideInstallFromMarketplace}
          />
        </PluginInstallPermissionProvider>
      )}
    </div>
  )
}

export default React.memo(QuotaPanel)
