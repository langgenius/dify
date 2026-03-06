import type { FC, RefObject } from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { tooltipManager } from '@/app/components/base/tooltip/TooltipManager'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import { cn } from '@/utils/classnames'
import { supportFunctionCall } from '@/utils/tool-call'
import { getMarketplaceUrl } from '@/utils/var'
import { ModelFeatureEnum } from '../declarations'
import { useLanguage, useMarketplaceAllPlugins } from '../hooks'
import { MODEL_PROVIDER_QUOTA_GET_PAID, modelNameMap, providerIconMap, providerKeyToPluginId } from '../utils'
import PopupItem from './popup-item'

type PopupProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  onSelect: (provider: string, model: ModelItem) => void
  scopeFeatures?: ModelFeatureEnum[]
  onHide: () => void
  triggerRef?: RefObject<HTMLDivElement | null>
}
const Popup: FC<PopupProps> = ({
  defaultModel,
  modelList,
  onSelect,
  scopeFeatures = [],
  onHide,
  triggerRef,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const language = useLanguage()
  const [searchText, setSearchText] = useState('')
  const [marketplaceCollapsed, setMarketplaceCollapsed] = useState(false)
  const { setShowAccountSettingModal } = useModalContext()
  const { modelProviders } = useProviderContext()
  const scrollRef = useRef<HTMLDivElement>(null)
  const triggerWidth = triggerRef?.current?.offsetWidth

  const {
    plugins: allPlugins,
  } = useMarketplaceAllPlugins(modelProviders, '')
  const { mutateAsync: installPackageFromMarketPlace } = useInstallPackageFromMarketPlace()
  const { refreshPluginList } = useRefreshPluginList()
  const [installingProvider, setInstallingProvider] = useState<ModelProviderQuotaGetPaid | null>(null)

  const handleInstallPlugin = useCallback(async (key: ModelProviderQuotaGetPaid) => {
    if (!allPlugins || installingProvider)
      return
    const pluginId = providerKeyToPluginId[key]
    const plugin = allPlugins.find(p => p.plugin_id === pluginId)
    if (!plugin)
      return

    const uniqueIdentifier = plugin.latest_package_identifier
    setInstallingProvider(key)
    try {
      const { all_installed, task_id } = await installPackageFromMarketPlace(uniqueIdentifier)
      if (!all_installed) {
        const { check } = checkTaskStatus()
        await check({ taskId: task_id, pluginUniqueIdentifier: uniqueIdentifier })
      }
      refreshPluginList(plugin)
    }
    catch { }
    finally {
      setInstallingProvider(null)
    }
  }, [allPlugins, installingProvider, installPackageFromMarketPlace, refreshPluginList])

  // Close any open tooltips when the user scrolls to prevent them from appearing
  // in incorrect positions or becoming detached from their trigger elements
  useEffect(() => {
    const handleTooltipCloseOnScroll = () => {
      tooltipManager.closeActiveTooltip()
    }

    const scrollContainer = scrollRef.current
    if (!scrollContainer)
      return

    // Use passive listener for better performance since we don't prevent default
    scrollContainer.addEventListener('scroll', handleTooltipCloseOnScroll, { passive: true })

    return () => {
      scrollContainer.removeEventListener('scroll', handleTooltipCloseOnScroll)
    }
  }, [])

  const filteredModelList = useMemo(() => {
    return modelList.map((model) => {
      const filteredModels = model.models
        .filter((modelItem) => {
          if (modelItem.label[language] !== undefined)
            return modelItem.label[language].toLowerCase().includes(searchText.toLowerCase())
          return Object.values(modelItem.label).some(label =>
            label.toLowerCase().includes(searchText.toLowerCase()),
          )
        })
        .filter((modelItem) => {
          if (scopeFeatures.length === 0)
            return true
          return scopeFeatures.every((feature) => {
            if (feature === ModelFeatureEnum.toolCall)
              return supportFunctionCall(modelItem.features)
            return modelItem.features?.includes(feature) ?? false
          })
        })
      return { ...model, models: filteredModels }
    }).filter(model => model.models.length > 0)
  }, [language, modelList, scopeFeatures, searchText])

  const marketplaceProviders = useMemo(() => {
    const installedProviders = new Set(modelList.map(m => m.provider))
    return MODEL_PROVIDER_QUOTA_GET_PAID.filter(key => !installedProviders.has(key))
  }, [modelList])

  return (
    <div ref={scrollRef} className="max-h-[480px] min-w-[320px] overflow-y-auto rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg no-scrollbar" style={triggerWidth ? { width: triggerWidth } : undefined}>
      <div className="sticky top-0 z-10 bg-components-panel-bg pb-1 pl-3 pr-2 pt-3">
        <div className={`
          flex h-8 items-center rounded-lg border pl-[9px] pr-[10px]
          ${searchText ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs' : 'border-transparent bg-components-input-bg-normal'}
        `}
        >
          <span
            className={`
              i-ri-search-line mr-[7px] h-[14px] w-[14px] shrink-0
              ${searchText ? 'text-text-tertiary' : 'text-text-quaternary'}
            `}
          />
          <input
            className="block h-[18px] grow appearance-none bg-transparent text-[13px] text-text-primary outline-none"
            placeholder={t('form.searchModel', { ns: 'datasetSettings' }) || ''}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
          {
            searchText && (
              <span
                className="i-custom-vender-solid-general-x-circle ml-1.5 h-[14px] w-[14px] shrink-0 cursor-pointer text-text-quaternary"
                onClick={() => setSearchText('')}
              />
            )
          }
        </div>
      </div>
      <div className="p-1">
        {
          filteredModelList.map(model => (
            <PopupItem
              key={model.provider}
              defaultModel={defaultModel}
              model={model}
              onSelect={onSelect}
            />
          ))
        }
        {!filteredModelList.length && !modelList.length && (
          <div className="flex flex-col gap-2 rounded-[10px] bg-gradient-to-r from-state-base-hover to-background-gradient-mask-transparent p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-[5px]">
              <span className="i-ri-brain-2-line h-5 w-5 text-text-tertiary" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-text-secondary system-sm-medium">
                {t('modelProvider.selector.noProviderConfigured', { ns: 'common' })}
              </p>
              <p className="text-text-tertiary system-xs-regular">
                {t('modelProvider.selector.noProviderConfiguredDesc', { ns: 'common' })}
              </p>
            </div>
            <Button
              variant="primary"
              className="w-[108px]"
              onClick={() => {
                onHide()
                setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
              }}
            >
              {t('modelProvider.selector.configure', { ns: 'common' })}
              <span className="i-ri-arrow-right-line h-4 w-4" />
            </Button>
          </div>
        )}
        {!filteredModelList.length && modelList.length > 0 && (
          <div className="break-all px-3 py-1.5 text-center text-xs leading-[18px] text-text-tertiary">
            {`No model found for \u201C${searchText}\u201D`}
          </div>
        )}
        {marketplaceProviders.length > 0 && (
          <>
            <div className="mx-2 my-1 border-t border-divider-subtle" />
            <div className="mb-1">
              <div className="flex h-[22px] items-center px-3">
                <div
                  className="flex flex-1 cursor-pointer items-center text-text-primary system-sm-medium"
                  onClick={() => setMarketplaceCollapsed(prev => !prev)}
                >
                  {t('modelProvider.selector.fromMarketplace', { ns: 'common' })}
                  <span className={cn('i-custom-vender-solid-general-arrow-down-round-fill h-4 w-4 text-text-quaternary', marketplaceCollapsed && '-rotate-90')} />
                </div>
              </div>
              {!marketplaceCollapsed && (
                <>
                  {marketplaceProviders.map((key) => {
                    const Icon = providerIconMap[key]
                    const isInstalling = installingProvider === key
                    return (
                      <div
                        key={key}
                        className="group flex cursor-pointer items-center gap-1 rounded-lg py-0.5 pl-3 pr-0.5 hover:bg-state-base-hover"
                      >
                        <div className="flex flex-1 items-center gap-2 py-0.5">
                          <Icon className="h-5 w-5 shrink-0 rounded-md" />
                          <span className="text-text-secondary system-sm-regular">{modelNameMap[key]}</span>
                        </div>
                        <Button
                          variant="secondary"
                          size="small"
                          className={cn(
                            'shrink-0 backdrop-blur-[5px]',
                            !isInstalling && 'hidden group-hover:flex',
                          )}
                          disabled={isInstalling}
                          onClick={() => handleInstallPlugin(key)}
                        >
                          {isInstalling && <span className="i-ri-loader-2-line h-3.5 w-3.5 animate-spin" />}
                          {isInstalling
                            ? t('installModal.installing', { ns: 'plugin' })
                            : t('modelProvider.selector.install', { ns: 'common' })}
                        </Button>
                      </div>
                    )
                  })}
                  <a
                    className="flex cursor-pointer items-center gap-0.5 px-3 pt-1.5"
                    href={getMarketplaceUrl('', { theme })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="flex-1 text-text-accent system-xs-regular">
                      {t('modelProvider.selector.discoverMoreInMarketplace', { ns: 'common' })}
                    </span>
                    <span className="i-ri-arrow-right-up-line !h-3 !w-3 text-text-accent" />
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div
        className="sticky bottom-0 flex cursor-pointer items-center rounded-b-lg border-t border-divider-subtle bg-components-panel-bg px-4 py-2 text-text-accent-light-mode-only"
        onClick={() => {
          onHide()
          setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
        }}
      >
        <span className="system-xs-medium">{t('model.settingsLink', { ns: 'common' })}</span>
        <span className="i-ri-arrow-right-up-line ml-0.5 h-3 w-3" />
      </div>
    </div>
  )
}

export default Popup
