'use client'
import type { TriggerDefaultValue, TriggerWithProvider } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import { RiMoreLine } from '@remixicon/react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownDoubleLine, ArrowDownRoundFill, ArrowUpDoubleLine } from '@/app/components/base/icons/src/vender/solid/arrows'
import Loading from '@/app/components/base/loading'
import Tooltip from '@/app/components/base/tooltip'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import Action from '@/app/components/workflow/block-selector/market-place-plugin/action'
import { useGetLanguage } from '@/context/i18n'
import { isServer } from '@/utils/client'
import { formatNumber } from '@/utils/format'
import { getMarketplaceUrl } from '@/utils/var'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import TriggerPluginItem from './trigger-plugin/item'

const MAX_RECOMMENDED_COUNT = 15
const INITIAL_VISIBLE_COUNT = 5

type FeaturedTriggersProps = {
  plugins: Plugin[]
  providerMap: Map<string, TriggerWithProvider>
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
  isLoading?: boolean
  onInstallSuccess?: () => void | Promise<void>
}

const STORAGE_KEY = 'workflow_triggers_featured_collapsed'

const FeaturedTriggers = ({
  plugins,
  providerMap,
  onSelect,
  isLoading = false,
  onInstallSuccess,
}: FeaturedTriggersProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (isServer)
      return false
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'true'
  })

  useEffect(() => {
    if (isServer)
      return
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null)
      setIsCollapsed(stored === 'true')
  }, [])

  useEffect(() => {
    if (isServer)
      return
    window.localStorage.setItem(STORAGE_KEY, String(isCollapsed))
  }, [isCollapsed])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }, [plugins])

  const limitedPlugins = useMemo(
    () => plugins.slice(0, MAX_RECOMMENDED_COUNT),
    [plugins],
  )

  const {
    installedProviders,
    uninstalledPlugins,
  } = useMemo(() => {
    const installed: TriggerWithProvider[] = []
    const uninstalled: Plugin[] = []
    const visitedProviderIds = new Set<string>()

    limitedPlugins.forEach((plugin) => {
      const provider = providerMap.get(plugin.plugin_id) || providerMap.get(plugin.latest_package_identifier)
      if (provider) {
        if (!visitedProviderIds.has(provider.id)) {
          installed.push(provider)
          visitedProviderIds.add(provider.id)
        }
      }
      else {
        uninstalled.push(plugin)
      }
    })

    return {
      installedProviders: installed,
      uninstalledPlugins: uninstalled,
    }
  }, [limitedPlugins, providerMap])

  const totalQuota = Math.min(visibleCount, MAX_RECOMMENDED_COUNT)

  const visibleInstalledProviders = useMemo(
    () => installedProviders.slice(0, totalQuota),
    [installedProviders, totalQuota],
  )

  const remainingSlots = Math.max(totalQuota - visibleInstalledProviders.length, 0)

  const visibleUninstalledPlugins = useMemo(
    () => (remainingSlots > 0 ? uninstalledPlugins.slice(0, remainingSlots) : []),
    [uninstalledPlugins, remainingSlots],
  )

  const totalVisible = visibleInstalledProviders.length + visibleUninstalledPlugins.length
  const maxAvailable = Math.min(MAX_RECOMMENDED_COUNT, installedProviders.length + uninstalledPlugins.length)
  const hasMoreToShow = totalVisible < maxAvailable
  const canToggleVisibility = maxAvailable > INITIAL_VISIBLE_COUNT
  const isExpanded = canToggleVisibility && !hasMoreToShow
  const showEmptyState = !isLoading && totalVisible === 0

  return (
    <div className="px-3 pb-3 pt-2">
      <button
        type="button"
        className="flex w-full items-center rounded-md px-0 py-1 text-left text-text-primary"
        onClick={() => setIsCollapsed(prev => !prev)}
      >
        <span className="system-xs-medium text-text-primary">{t('tabs.featuredTools', { ns: 'workflow' })}</span>
        <ArrowDownRoundFill className={`ml-0.5 h-4 w-4 text-text-tertiary transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />
      </button>

      {!isCollapsed && (
        <>
          {isLoading && (
            <div className="py-3">
              <Loading type="app" />
            </div>
          )}

          {showEmptyState && (
            <p className="system-xs-regular py-2 text-text-tertiary">
              <Link className="text-text-accent" href={getMarketplaceUrl('', { category: 'trigger' })} target="_blank" rel="noopener noreferrer">
                {t('tabs.noFeaturedTriggers', { ns: 'workflow' })}
              </Link>
            </p>
          )}

          {!showEmptyState && !isLoading && (
            <>
              {visibleInstalledProviders.length > 0 && (
                <div className="mt-1">
                  {visibleInstalledProviders.map(provider => (
                    <TriggerPluginItem
                      key={provider.id}
                      payload={provider}
                      hasSearchText={false}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              )}

              {visibleUninstalledPlugins.length > 0 && (
                <div className="mt-1 flex flex-col gap-1">
                  {visibleUninstalledPlugins.map(plugin => (
                    <FeaturedTriggerUninstalledItem
                      key={plugin.plugin_id}
                      plugin={plugin}
                      language={language}
                      onInstallSuccess={async () => {
                        await onInstallSuccess?.()
                      }}
                      t={t as any}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {!isLoading && totalVisible > 0 && canToggleVisibility && (
            <div
              className="group mt-1 flex cursor-pointer items-center gap-x-2 rounded-lg py-1 pl-3 pr-2 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
              onClick={() => {
                setVisibleCount((count) => {
                  if (count >= maxAvailable)
                    return INITIAL_VISIBLE_COUNT

                  return Math.min(count + INITIAL_VISIBLE_COUNT, maxAvailable)
                })
              }}
            >
              <div className="flex items-center px-1 text-text-tertiary transition-colors group-hover:text-text-secondary">
                <RiMoreLine className="size-4 group-hover:hidden" />
                {isExpanded
                  ? (
                      <ArrowUpDoubleLine className="hidden size-4 group-hover:block" />
                    )
                  : (
                      <ArrowDownDoubleLine className="hidden size-4 group-hover:block" />
                    )}
              </div>
              <div className="system-xs-regular">
                {t(isExpanded ? 'tabs.showLessFeatured' : 'tabs.showMoreFeatured', { ns: 'workflow' })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

type FeaturedTriggerUninstalledItemProps = {
  plugin: Plugin
  language: Locale
  onInstallSuccess?: () => Promise<void> | void
  t: (key: string, options?: Record<string, any>) => string
}

function FeaturedTriggerUninstalledItem({
  plugin,
  language,
  onInstallSuccess,
  t,
}: FeaturedTriggerUninstalledItemProps) {
  const label = plugin.label?.[language] || plugin.name
  const description = typeof plugin.brief === 'object' ? plugin.brief[language] : plugin.brief
  const installCountLabel = t('install', { ns: 'plugin', num: formatNumber(plugin.install_count || 0) })
  const [actionOpen, setActionOpen] = useState(false)
  const [isActionHovered, setIsActionHovered] = useState(false)
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false)

  useEffect(() => {
    if (!actionOpen)
      return

    const handleScroll = () => {
      setActionOpen(false)
      setIsActionHovered(false)
    }

    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [actionOpen])

  return (
    <>
      <Tooltip
        position="right"
        needsDelay={false}
        popupClassName="!p-0 !px-3 !py-2.5 !w-[224px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !rounded-xl !shadow-lg"
        popupContent={(
          <div>
            <BlockIcon size="md" className="mb-2" type={BlockEnum.TriggerPlugin} toolIcon={plugin.icon} />
            <div className="mb-1 text-sm leading-5 text-text-primary">{label}</div>
            <div className="text-xs leading-[18px] text-text-secondary">{description}</div>
          </div>
        )}
        disabled={!description || isActionHovered || actionOpen || isInstallModalOpen}
      >
        <div
          className="group flex h-8 w-full items-center rounded-lg pl-3 pr-1 hover:bg-state-base-hover"
        >
          <div className="flex h-full min-w-0 items-center">
            <BlockIcon type={BlockEnum.TriggerPlugin} toolIcon={plugin.icon} />
            <div className="ml-2 min-w-0">
              <div className="system-sm-medium truncate text-text-secondary">{label}</div>
            </div>
          </div>
          <div className="ml-auto flex h-full items-center gap-1 pl-1">
            <span className={`system-xs-regular text-text-tertiary ${actionOpen ? 'hidden' : 'group-hover:hidden'}`}>{installCountLabel}</span>
            <div
              className={`system-xs-medium flex h-full items-center gap-1 text-components-button-secondary-accent-text [&_.action-btn]:h-6 [&_.action-btn]:min-h-0 [&_.action-btn]:w-6 [&_.action-btn]:rounded-lg [&_.action-btn]:p-0 ${actionOpen ? 'flex' : 'hidden group-hover:flex'}`}
              onMouseEnter={() => setIsActionHovered(true)}
              onMouseLeave={() => {
                if (!actionOpen)
                  setIsActionHovered(false)
              }}
            >
              <button
                type="button"
                className="cursor-pointer rounded-md px-1.5 py-0.5 hover:bg-state-base-hover"
                onClick={() => {
                  setActionOpen(false)
                  setIsInstallModalOpen(true)
                  setIsActionHovered(true)
                }}
              >
                {t('installAction', { ns: 'plugin' })}
              </button>
              <Action
                open={actionOpen}
                onOpenChange={(value) => {
                  setActionOpen(value)
                  setIsActionHovered(value)
                }}
                author={plugin.org}
                name={plugin.name}
                version={plugin.latest_version}
              />
            </div>
          </div>
        </div>
      </Tooltip>
      {isInstallModalOpen && (
        <InstallFromMarketplace
          uniqueIdentifier={plugin.latest_package_identifier}
          manifest={plugin}
          onSuccess={async () => {
            setIsInstallModalOpen(false)
            setIsActionHovered(false)
            await onInstallSuccess?.()
          }}
          onClose={() => {
            setIsInstallModalOpen(false)
            setIsActionHovered(false)
          }}
        />
      )}
    </>
  )
}

export default FeaturedTriggers
