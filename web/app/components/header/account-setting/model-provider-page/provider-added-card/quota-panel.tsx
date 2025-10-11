import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProvider } from '../declarations'
import { AnthropicShortLight, Deepseek, Gemini, Grok, OpenaiSmall } from '@/app/components/base/icons/src/public/llm'
import Tooltip from '@/app/components/base/tooltip'
import { formatNumber } from '@/utils/format'
import { useAppContext } from '@/context/app-context'
import { ModelProviderQuotaGetPaid, modelNameMap } from '../utils'
import cn from '@/utils/classnames'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useMarketplaceAllPlugins } from '../hooks'
import { useBoolean } from 'ahooks'
import useTimestamp from '@/hooks/use-timestamp'
import Loading from '@/app/components/base/loading'

const allProviders = [
  { key: ModelProviderQuotaGetPaid.OPENAI, Icon: OpenaiSmall },
  { key: ModelProviderQuotaGetPaid.ANTHROPIC, Icon: AnthropicShortLight },
  { key: ModelProviderQuotaGetPaid.GEMINI, Icon: Gemini },
  { key: ModelProviderQuotaGetPaid.X, Icon: Grok },
  { key: ModelProviderQuotaGetPaid.DEEPSEEK, Icon: Deepseek },
] as const

// Map provider key to plugin ID
// provider key format: langgenius/provider/model, plugin ID format: langgenius/provider
const providerKeyToPluginId: Record<string, string> = {
  [ModelProviderQuotaGetPaid.OPENAI]: 'langgenius/openai',
  [ModelProviderQuotaGetPaid.ANTHROPIC]: 'langgenius/anthropic',
  [ModelProviderQuotaGetPaid.GEMINI]: 'langgenius/gemini',
  [ModelProviderQuotaGetPaid.X]: 'langgenius/x',
  [ModelProviderQuotaGetPaid.DEEPSEEK]: 'langgenius/deepseek',
}

type QuotaPanelProps = {
  providers: ModelProvider[]
  isLoading?: boolean
}
const QuotaPanel: FC<QuotaPanelProps> = ({
  providers,
  isLoading = false,
}) => {
  const { t } = useTranslation()
  const { currentWorkspace } = useAppContext()
  const credits = Math.max(currentWorkspace.trial_credits - currentWorkspace.trial_credits_used, 0)
  const providerSet = new Set(providers.map(p => p.provider))
  const { formatTime } = useTimestamp()
  const {
    plugins: allPlugins,
  } = useMarketplaceAllPlugins(providers, '')
  const [selectedPlugin, setSelectedPlugin] = useState<any>(null)
  const [isShowInstallModal, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)
  const selectedPluginIdRef = useRef<string | null>(null)

  const handleIconClick = useCallback((key: string, isAvailable: boolean) => {
    if (!isAvailable && allPlugins) {
      const pluginId = providerKeyToPluginId[key]
      const plugin = allPlugins.find(p => p.plugin_id === pluginId)
      if (plugin) {
        setSelectedPlugin(plugin)
        selectedPluginIdRef.current = pluginId
        showInstallFromMarketplace()
      }
    }
  }, [allPlugins, showInstallFromMarketplace])

  // Listen to providers changes and auto-close modal if installation succeeds
  useEffect(() => {
    if (isShowInstallModal && selectedPluginIdRef.current) {
      const isInstalled = providers.some(p => p.provider.startsWith(selectedPluginIdRef.current!))
      if (isInstalled) {
        hideInstallFromMarketplace()
        selectedPluginIdRef.current = null
      }
    }
  }, [providers, isShowInstallModal, hideInstallFromMarketplace])
  console.log('isLoading', isLoading)
  if (isLoading) {
    return (
      <div className='my-2 flex min-h-[72px] items-center justify-center rounded-xl border-[0.5px] border-components-panel-border bg-third-party-model-bg-default shadow-xs'>
        <Loading />
      </div>
    )
  }

  return (
    <div className={cn('my-2 min-w-[72px] shrink-0 rounded-xl border-[0.5px] pb-2.5 pl-4 pr-2.5 pt-3 shadow-xs', credits <= 0 ? 'border-state-destructive-border hover:bg-state-destructive-hover' : 'border-components-panel-border bg-third-party-model-bg-default')}>
      <div className='system-xs-medium-uppercase mb-2 flex h-4 items-center text-text-tertiary'>
        {t('common.modelProvider.quota')}
        <Tooltip popupContent={t('common.modelProvider.card.tip')}
        />
      </div>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1 text-xs text-text-tertiary'>
          <span className='system-md-semibold-uppercase mr-0.5 text-text-secondary'>{formatNumber(credits)}</span>
          <span>{t('common.modelProvider.credits')}</span>
          {currentWorkspace.next_credit_reset_date ? (
            <>
              <span>·</span>
              <span>{t('common.modelProvider.resetDate', {
                date: formatTime(currentWorkspace.next_credit_reset_date, t('appLog.dateFormat') as string),
                interpolation: { escapeValue: false },
              })}</span>
            </>
          ) : null}
        </div>
        <div className='flex items-center gap-1'>
          {allProviders.map(({ key, Icon }) => {
            const isAvailable = providerSet.has(key)
            return (
              <Tooltip
                key={key}
                popupContent={t(isAvailable ? 'common.modelProvider.card.modelSupported' : 'common.modelProvider.card.modelNotSupported', { modelName: modelNameMap[key] })}
              >
                <div
                  className={cn('relative h-6 w-6', !isAvailable && 'cursor-pointer hover:opacity-80')}
                  onClick={() => handleIconClick(key, isAvailable)}
                >
                  <Icon className='h-6 w-6' />
                  {!isAvailable && (
                    <div className='absolute inset-0 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge opacity-30' />
                  )}
                </div>
              </Tooltip>
            )
          })}
        </div>
      </div>
      {isShowInstallModal && (
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
