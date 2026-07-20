'use client'
import type { TFunction } from 'i18next'
import type { TriggerPluginActionPreviewPayload } from './trigger-plugin/action-item'
import type { TriggerDefaultValue, TriggerWithProvider } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { PluginInstallPermissionProvider } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import Action from '@/app/components/workflow/block-selector/market-place-plugin/action'
import { useFeaturedTriggersCollapsed } from '@/app/components/workflow/block-selector/storage'
import { useGetLanguage } from '@/context/i18n'
import Link from '@/next/link'
import { formatNumber } from '@/utils/format'
import { getMarketplaceUrl } from '@/utils/var'
import { PluginCategoryEnum } from '../../plugins/types'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import { BlockSelectorRow } from './block-selector-row'
import { BlockSelectorPreviewCardContent } from './preview-card'
import { TriggerPluginActionPreviewCard } from './trigger-plugin/action-item'
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
type FeaturedTriggerPreviewPayload = {
  plugin: Plugin
  label: string
  description: string
}

const FeaturedTriggers = ({
  plugins,
  providerMap,
  onSelect,
  isLoading = false,
  onInstallSuccess,
}: FeaturedTriggersProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const previewCardHandle = useMemo(
    () => createPreviewCardHandle<FeaturedTriggerPreviewPayload>(),
    [],
  )
  const triggerActionPreviewCardHandle = useMemo(
    () => createPreviewCardHandle<TriggerPluginActionPreviewPayload>(),
    [],
  )
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)
  const [visibleCountPlugins, setVisibleCountPlugins] = useState(plugins)
  const [isCollapsed, setIsCollapsed] = useFeaturedTriggersCollapsed()

  if (visibleCountPlugins !== plugins) {
    setVisibleCountPlugins(plugins)
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }

  const limitedPlugins = useMemo(() => plugins.slice(0, MAX_RECOMMENDED_COUNT), [plugins])

  const { installedProviders, uninstalledPlugins } = useMemo(() => {
    const installed: TriggerWithProvider[] = []
    const uninstalled: Plugin[] = []
    const visitedProviderIds = new Set<string>()

    limitedPlugins.forEach((plugin) => {
      const provider =
        providerMap.get(plugin.plugin_id) || providerMap.get(plugin.latest_package_identifier)
      if (provider) {
        if (!visitedProviderIds.has(provider.id)) {
          installed.push(provider)
          visitedProviderIds.add(provider.id)
        }
      } else {
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
  const maxAvailable = Math.min(
    MAX_RECOMMENDED_COUNT,
    installedProviders.length + uninstalledPlugins.length,
  )
  const hasMoreToShow = totalVisible < maxAvailable
  const canToggleVisibility = maxAvailable > INITIAL_VISIBLE_COUNT
  const isExpanded = canToggleVisibility && !hasMoreToShow
  const showEmptyState = !isLoading && totalVisible === 0

  return (
    <Collapsible
      className="pt-2 pb-3"
      open={!isCollapsed}
      onOpenChange={(open) => setIsCollapsed(!open)}
    >
      <CollapsibleTrigger className="min-h-0 justify-start gap-0 rounded-md px-4 py-1 hover:not-data-disabled:bg-transparent">
        <span className="system-xs-medium text-text-primary">
          {t(($) => $['tabs.featuredTools'], { ns: 'workflow' })}
        </span>
        <span
          aria-hidden
          className="ml-0.5 i-custom-vender-solid-arrows-arrow-down-round-fill size-4 -rotate-90 text-text-tertiary transition-transform group-data-panel-open:rotate-0 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>

      <CollapsiblePanel>
        {isLoading && (
          <div className="py-3">
            <Loading type="app" />
          </div>
        )}

        {showEmptyState && (
          <p className="px-4 py-2 system-xs-regular text-text-tertiary">
            <Link
              className="text-text-accent"
              href={getMarketplaceCategoryUrl(PluginCategoryEnum.trigger)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(($) => $['tabs.noFeaturedTriggers'], { ns: 'workflow' })}
            </Link>
          </p>
        )}

        {!showEmptyState && !isLoading && (
          <div className="mt-1 p-1">
            {visibleInstalledProviders.map((provider) => (
              <TriggerPluginItem
                key={provider.id}
                payload={provider}
                hasSearchText={false}
                previewCardHandle={triggerActionPreviewCardHandle}
                onSelect={onSelect}
              />
            ))}

            {visibleUninstalledPlugins.map((plugin) => (
              <div key={plugin.plugin_id} className="mb-1 last-of-type:mb-0">
                <FeaturedTriggerUninstalledItem
                  plugin={plugin}
                  language={language}
                  previewCardHandle={previewCardHandle}
                  onInstallSuccess={async () => {
                    await onInstallSuccess?.()
                  }}
                  t={t}
                />
              </div>
            ))}
          </div>
        )}

        {!isLoading && totalVisible > 0 && canToggleVisibility && (
          <button
            type="button"
            className="group mt-1 flex w-full cursor-pointer touch-manipulation items-center gap-x-2 rounded-lg border-0 bg-transparent py-1 pr-2 pl-3 text-left text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
            onClick={() => {
              setVisibleCount((count) => {
                if (count >= maxAvailable) return INITIAL_VISIBLE_COUNT

                return Math.min(count + INITIAL_VISIBLE_COUNT, maxAvailable)
              })
            }}
          >
            <div className="flex items-center px-1 text-text-tertiary group-hover:text-text-secondary group-focus-visible:text-text-secondary">
              <span
                aria-hidden
                className="i-ri-more-line size-4 group-hover:hidden group-focus-visible:hidden"
              />
              {isExpanded ? (
                <span
                  aria-hidden
                  className="i-custom-vender-solid-arrows-arrow-up-double-line hidden size-4 group-hover:block group-focus-visible:block"
                />
              ) : (
                <span
                  aria-hidden
                  className="i-custom-vender-solid-arrows-arrow-down-double-line hidden size-4 group-hover:block group-focus-visible:block"
                />
              )}
            </div>
            <div className="system-xs-regular">
              {t(($) => $[isExpanded ? 'tabs.showLessFeatured' : 'tabs.showMoreFeatured'], {
                ns: 'workflow',
              })}
            </div>
          </button>
        )}
      </CollapsiblePanel>
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => (
          <FeaturedTriggerPreviewCard
            payload={payload as FeaturedTriggerPreviewPayload | undefined}
          />
        )}
      </PreviewCard>
      <PreviewCard handle={triggerActionPreviewCardHandle}>
        {({ payload }) => (
          <TriggerPluginActionPreviewCard
            payload={payload as TriggerPluginActionPreviewPayload | undefined}
          />
        )}
      </PreviewCard>
    </Collapsible>
  )
}

type FeaturedTriggerUninstalledItemProps = {
  plugin: Plugin
  language: Locale
  previewCardHandle: ReturnType<typeof createPreviewCardHandle<FeaturedTriggerPreviewPayload>>
  onInstallSuccess?: () => Promise<void> | void
  t: TFunction
}

function FeaturedTriggerUninstalledItem({
  plugin,
  language,
  previewCardHandle,
  onInstallSuccess,
  t,
}: FeaturedTriggerUninstalledItemProps) {
  const label = plugin.label?.[language] || plugin.name
  const description = typeof plugin.brief === 'object' ? plugin.brief[language] : plugin.brief
  const installCountLabel = t(($) => $.install, {
    ns: 'plugin',
    num: formatNumber(plugin.install_count || 0),
  })
  const [actionOpen, setActionOpen] = useState(false)
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false)
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()

  useEffect(() => {
    if (!actionOpen) return

    const handleScroll = () => {
      setActionOpen(false)
    }

    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [actionOpen])

  const detailsLink = (
    <Link
      className="flex h-full min-w-0 flex-1 items-center rounded-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      href={getMarketplaceUrl(`/plugins/${plugin.org}/${plugin.name}`)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="flex min-w-0 items-center">
        <BlockIcon
          className="mr-2 shrink-0"
          type={BlockEnum.TriggerPlugin}
          size="sm"
          toolIcon={plugin.icon}
        />
        <div className="min-w-0">
          <div className="truncate system-sm-medium text-text-secondary">{label}</div>
        </div>
      </div>
    </Link>
  )

  return (
    <>
      <BlockSelectorRow as="div" className="group select-none focus-within:bg-state-base-hover">
        {description ? (
          <PreviewCardTrigger
            delay={150}
            closeDelay={150}
            handle={previewCardHandle}
            payload={{ plugin, label, description }}
            render={detailsLink}
          />
        ) : (
          detailsLink
        )}
        <div className="relative ml-auto flex h-6 items-center pl-1">
          <span
            className={cn(
              'system-xs-regular text-text-tertiary',
              actionOpen
                ? 'hidden'
                : 'group-focus-within:hidden group-hover:hidden [@media(hover:none)]:hidden',
            )}
          >
            {installCountLabel}
          </span>
          <div
            className={cn(
              'absolute right-0 flex h-full items-center gap-1 system-xs-medium text-components-button-secondary-accent-text opacity-0 transition-opacity motion-reduce:transition-none [&_.action-btn]:size-6 [&_.action-btn]:min-h-0 [&_.action-btn]:rounded-lg [&_.action-btn]:p-0',
              actionOpen
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
            )}
          >
            {canInstallPlugin && (
              <button
                type="button"
                className="cursor-pointer rounded-md px-1.5 py-0.5 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                onClick={() => {
                  setActionOpen(false)
                  setIsInstallModalOpen(true)
                }}
              >
                {t(($) => $.installAction, { ns: 'plugin' })}
              </button>
            )}
            <Action
              open={actionOpen}
              onOpenChange={setActionOpen}
              author={plugin.org}
              name={plugin.name}
              version={plugin.latest_version}
            />
          </div>
        </div>
      </BlockSelectorRow>
      {isInstallModalOpen && canInstallPlugin && (
        <PluginInstallPermissionProvider
          canInstallPlugin={canInstallPlugin}
          currentDifyVersion={currentDifyVersion}
        >
          <InstallFromMarketplace
            uniqueIdentifier={plugin.latest_package_identifier}
            manifest={plugin}
            onSuccess={async () => {
              setIsInstallModalOpen(false)
              await onInstallSuccess?.()
            }}
            onClose={() => {
              setIsInstallModalOpen(false)
            }}
          />
        </PluginInstallPermissionProvider>
      )}
    </>
  )
}

type FeaturedTriggerPreviewCardProps = {
  payload?: FeaturedTriggerPreviewPayload
}

function FeaturedTriggerPreviewCard({ payload }: FeaturedTriggerPreviewCardProps) {
  if (!payload) return null

  return (
    <BlockSelectorPreviewCardContent>
      <BlockIcon
        size="md"
        className="mb-2"
        type={BlockEnum.TriggerPlugin}
        toolIcon={payload.plugin.icon}
      />
      <div className="mb-1 text-sm/5 text-text-primary">{payload.label}</div>
      <div className="text-xs leading-[18px] wrap-break-word text-text-secondary">
        {payload.description}
      </div>
    </BlockSelectorPreviewCardContent>
  )
}

export default FeaturedTriggers
