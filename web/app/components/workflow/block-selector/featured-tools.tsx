'use client'
import type { TFunction } from 'i18next'
import type { ToolWithProvider } from '../types'
import type { ToolDefaultValue, ToolValue } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import { Button } from '@langgenius/dify-ui/button'
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
import Action from '@/app/components/workflow/block-selector/marketplace-plugin/action'
import { useFeaturedToolsCollapsed } from '@/app/components/workflow/block-selector/storage'
import { useGetLanguage } from '@/context/i18n'
import Link from '@/next/link'
import { formatNumber } from '@/utils/format'
import { getMarketplaceUrl } from '@/utils/var'
import { PluginCategoryEnum } from '../../plugins/types'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import { BlockSelectorPreviewCardContent } from './preview-card'
import Tools from './tools'
import { ToolType, ViewType } from './types'

const MAX_RECOMMENDED_COUNT = 15
const INITIAL_VISIBLE_COUNT = 5

type FeaturedToolsProps = {
  plugins: Plugin[]
  providerMap: Map<string, ToolWithProvider>
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  selectedTools?: ToolValue[]
  isLoading?: boolean
  onInstallSuccess?: () => void
}
type FeaturedToolPreviewPayload = {
  plugin: Plugin
  label: string
  description: string
}

const FeaturedTools = ({
  plugins,
  providerMap,
  onSelect,
  selectedTools,
  isLoading = false,
  onInstallSuccess,
}: FeaturedToolsProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const previewCardHandle = useMemo(() => createPreviewCardHandle<FeaturedToolPreviewPayload>(), [])
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)
  const [visibleCountPlugins, setVisibleCountPlugins] = useState(plugins)
  const [isCollapsed, setIsCollapsed] = useFeaturedToolsCollapsed()

  if (visibleCountPlugins !== plugins) {
    setVisibleCountPlugins(plugins)
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }

  const limitedPlugins = useMemo(() => plugins.slice(0, MAX_RECOMMENDED_COUNT), [plugins])

  const { installedProviders, uninstalledPlugins } = useMemo(() => {
    const installed: ToolWithProvider[] = []
    const uninstalled: Plugin[] = []
    const visitedProviderIds = new Set<string>()

    limitedPlugins.forEach((plugin) => {
      const provider = providerMap.get(plugin.plugin_id)
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
  const isShowingAll = canToggleVisibility && !hasMoreToShow
  const showEmptyState = !isLoading && totalVisible === 0

  return (
    <Collapsible
      className="px-3 pt-2 pb-3"
      open={!isCollapsed}
      onOpenChange={(open) => setIsCollapsed(!open)}
    >
      <CollapsibleTrigger className="-ml-2 min-h-0 w-fit justify-start gap-0 rounded-md px-2 py-1 hover:not-data-disabled:bg-transparent focus-visible:ring-inset">
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
          <p className="py-2 system-xs-regular text-text-tertiary">
            <Link
              className="text-text-accent"
              href={getMarketplaceCategoryUrl(PluginCategoryEnum.tool)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(($) => $['tabs.noFeaturedPlugins'], { ns: 'workflow' })}
            </Link>
          </p>
        )}

        {!showEmptyState && !isLoading && (
          <div>
            {visibleInstalledProviders.length > 0 && (
              <Tools
                className="p-0"
                tools={visibleInstalledProviders}
                onSelect={onSelect}
                canNotSelectMultiple
                toolType={ToolType.All}
                viewType={ViewType.flat}
                hasSearchText={false}
                selectedTools={selectedTools}
              />
            )}

            {visibleUninstalledPlugins.length > 0 && (
              <div className="mt-1 flex flex-col gap-1">
                {visibleUninstalledPlugins.map((plugin) => (
                  <FeaturedToolUninstalledItem
                    key={plugin.plugin_id}
                    plugin={plugin}
                    language={language}
                    previewCardHandle={previewCardHandle}
                    onInstallSuccess={async () => {
                      await onInstallSuccess?.()
                    }}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {!isLoading && totalVisible > 0 && canToggleVisibility && (
          <Button
            variant="ghost"
            size="medium"
            className="group mt-1 w-full justify-start gap-x-2 pr-2 pl-3 text-left text-text-tertiary hover:text-text-secondary focus-visible:ring-inset"
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
              {isShowingAll ? (
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
              {t(($) => $[isShowingAll ? 'tabs.showLessFeatured' : 'tabs.showMoreFeatured'], {
                ns: 'workflow',
              })}
            </div>
          </Button>
        )}
      </CollapsiblePanel>
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => (
          <FeaturedToolPreviewCard payload={payload as FeaturedToolPreviewPayload | undefined} />
        )}
      </PreviewCard>
    </Collapsible>
  )
}

type FeaturedToolUninstalledItemProps = {
  plugin: Plugin
  language: Locale
  previewCardHandle: ReturnType<typeof createPreviewCardHandle<FeaturedToolPreviewPayload>>
  onInstallSuccess?: () => Promise<void> | void
  t: TFunction
}

function FeaturedToolUninstalledItem({
  plugin,
  language,
  previewCardHandle,
  onInstallSuccess,
  t,
}: FeaturedToolUninstalledItemProps) {
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
      className="flex h-full w-full min-w-0 items-center rounded-lg px-3 group-hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
      href={getMarketplaceUrl(`/plugins/${plugin.org}/${plugin.name}`)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <BlockIcon className="shrink-0" type={BlockEnum.Tool} toolIcon={plugin.icon} />
      <span className="ml-2 truncate system-sm-medium text-text-secondary">{label}</span>
      <span
        aria-hidden
        className={cn(
          'ml-auto shrink-0 pl-2 system-xs-regular text-text-tertiary',
          actionOpen
            ? 'invisible'
            : 'group-focus-within:invisible group-hover:invisible [@media(hover:none)]:invisible',
        )}
      >
        {installCountLabel}
      </span>
    </Link>
  )

  return (
    <>
      <div className="group relative flex h-8 w-full items-center rounded-lg">
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
        <div
          className={cn(
            'absolute inset-y-0 right-1 flex items-center gap-1 system-xs-medium text-components-button-secondary-accent-text opacity-0',
            actionOpen
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
          )}
        >
          {canInstallPlugin && (
            <Button
              variant="ghost"
              size="small"
              className="text-components-button-secondary-accent-text"
              onClick={() => {
                setActionOpen(false)
                setIsInstallModalOpen(true)
              }}
            >
              {t(($) => $.installAction, { ns: 'plugin' })}
            </Button>
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

type FeaturedToolPreviewCardProps = {
  payload?: FeaturedToolPreviewPayload
}

function FeaturedToolPreviewCard({ payload }: FeaturedToolPreviewCardProps) {
  if (!payload) return null

  return (
    <BlockSelectorPreviewCardContent>
      <BlockIcon size="md" className="mb-2" type={BlockEnum.Tool} toolIcon={payload.plugin.icon} />
      <div className="mb-1 text-sm/5 text-text-primary">{payload.label}</div>
      <div className="text-xs leading-[18px] wrap-break-word text-text-secondary">
        {payload.description}
      </div>
    </BlockSelectorPreviewCardContent>
  )
}

export default FeaturedTools
