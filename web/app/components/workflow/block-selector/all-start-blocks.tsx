'use client'
import type {
  RefObject,
} from 'react'
import type { BlockEnum, OnSelectBlock } from '../types'
import type { ListRef } from './market-place-plugin/list'
import type { TriggerDefaultValue, TriggerWithProvider } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowRightUpLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { SearchMenu } from '@/app/components/base/icons/src/vender/line/general'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { useFeaturedTriggersRecommendations } from '@/service/use-plugins'
import { useAllTriggerPlugins, useInvalidateAllTriggerPlugins } from '@/service/use-triggers'
import { getMarketplaceUrl } from '@/utils/var'
import { useMarketplacePlugins } from '../../plugins/marketplace/hooks'
import { PluginCategoryEnum } from '../../plugins/types'
import { BlockEnum as BlockEnumValue } from '../types'
import { ENTRY_NODE_TYPES } from './constants'
import FeaturedTriggers from './featured-triggers'
import PluginList from './market-place-plugin/list'
import StartBlocks from './start-blocks'
import TriggerPluginList from './trigger-plugin/list'

const popoverMarketplaceFooterClassName = 'system-sm-medium z-10 flex h-8 flex-none cursor-pointer items-center rounded-b-lg border-[0.5px] border-t border-components-panel-border bg-components-panel-bg-blur px-4 py-1 text-text-accent-light-mode-only shadow-lg'
const panelMarketplaceFooterClassName = 'system-xs-regular z-10 flex flex-none cursor-pointer flex-col items-start gap-2 px-4 pt-2 pb-4 text-text-tertiary hover:text-text-secondary'

const SectionDivider = () => (
  <div className="px-4 py-1" aria-hidden>
    <Divider type="horizontal" className="my-0 h-px bg-divider-subtle" />
  </div>
)

const MarketplaceFooterDivider = () => (
  <div className="flex h-2 w-8 items-center" aria-hidden>
    <Divider type="horizontal" className="my-0 h-px w-8 bg-divider-subtle" />
  </div>
)

type AllStartBlocksProps = {
  className?: string
  searchText: string
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  tags?: string[]
  allowUserInputSelection?: boolean // Allow user input option even when trigger node already exists (e.g. when no Start node yet or changing node type).
  hasUserInputNode?: boolean
  hasTriggerNode?: boolean
  variant?: 'popover' | 'panel'
}

const AllStartBlocks = ({
  className,
  searchText,
  onSelect,
  availableBlocksTypes,
  tags = [],
  allowUserInputSelection = false,
  hasUserInputNode = false,
  hasTriggerNode = false,
  variant = 'popover',
}: AllStartBlocksProps) => {
  const { t } = useTranslation()
  const [hasStartBlocksContent, setHasStartBlocksContent] = useState(false)
  const [hasPluginContent, setHasPluginContent] = useState(false)
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const pluginRef = useRef<ListRef>(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)

  const entryNodeTypes = useMemo(() => {
    return availableBlocksTypes?.length
      ? availableBlocksTypes
      : [...ENTRY_NODE_TYPES]
  }, [availableBlocksTypes])
  const enableTriggerPlugin = entryNodeTypes.includes(BlockEnumValue.TriggerPlugin)
  const { data: triggerProviders = [] } = useAllTriggerPlugins(enableTriggerPlugin)
  const providerMap = useMemo(() => {
    const map = new Map<string, TriggerWithProvider>()
    triggerProviders.forEach((provider) => {
      const keys = [
        provider.plugin_id,
        provider.plugin_unique_identifier,
        provider.id,
      ].filter(Boolean) as string[]
      keys.forEach((key) => {
        if (!map.has(key))
          map.set(key, provider)
      })
    })
    return map
  }, [triggerProviders])
  const invalidateTriggers = useInvalidateAllTriggerPlugins()
  const trimmedSearchText = searchText.trim()
  const hasSearchText = trimmedSearchText.length > 0
  const hasFilter = hasSearchText || tags.length > 0
  const {
    plugins: featuredPlugins = [],
    isLoading: featuredLoading,
  } = useFeaturedTriggersRecommendations(enableTriggerPlugin && enable_marketplace && !hasFilter)
  const {
    queryPluginsWithDebounced: fetchPlugins,
    plugins: marketplacePlugins = [],
  } = useMarketplacePlugins()

  const shouldShowFeatured = enableTriggerPlugin
    && enable_marketplace
    && !hasFilter
  const shouldShowMarketplaceFooter = enable_marketplace
  const isPanelVariant = variant === 'panel'

  const handleStartBlocksContentChange = useCallback((hasContent: boolean) => {
    setHasStartBlocksContent(hasContent)
  }, [])

  const handlePluginContentChange = useCallback((hasContent: boolean) => {
    setHasPluginContent(hasContent)
  }, [])

  const hasMarketplaceContent = enableTriggerPlugin && enable_marketplace && marketplacePlugins.length > 0
  const hasAnyContent = hasStartBlocksContent || hasPluginContent || shouldShowFeatured || hasMarketplaceContent
  const shouldShowEmptyState = hasFilter && !hasAnyContent
  const shouldShowInstalledTriggersDivider = isPanelVariant && hasStartBlocksContent && enableTriggerPlugin && hasPluginContent
  const shouldShowMarketplaceSectionDivider = enableTriggerPlugin
    && enable_marketplace
    && (hasStartBlocksContent || hasPluginContent)
    && (shouldShowFeatured || hasMarketplaceContent)

  useEffect(() => {
    if (!enableTriggerPlugin && hasPluginContent)
      setHasPluginContent(false)
  }, [enableTriggerPlugin, hasPluginContent])

  useEffect(() => {
    if (!enableTriggerPlugin || !enable_marketplace)
      return
    if (hasFilter) {
      fetchPlugins({
        query: searchText,
        tags,
        category: PluginCategoryEnum.trigger,
      })
    }
  }, [enableTriggerPlugin, enable_marketplace, hasFilter, fetchPlugins, searchText, tags])

  return (
    <div className={cn('max-w-[500px] min-w-[400px]', variant === 'panel' && 'h-full max-w-none min-w-0', className)}>
      <div className={cn('flex max-h-[640px] flex-col', variant === 'panel' && 'h-full max-h-none')}>
        <div
          ref={wrapElemRef}
          className="flex-1 overflow-y-auto"
          onScroll={() => pluginRef.current?.handleScroll()}
        >
          <div className={cn(shouldShowEmptyState && 'hidden')}>
            {hasUserInputNode && (
              <div className="relative flex items-start gap-0.5 overflow-hidden border-b-[0.5px] border-divider-subtle bg-components-panel-bg-blur px-3 py-2">
                <div className="absolute inset-0 bg-linear-to-r from-util-colors-blue-light-blue-light-500/20 to-transparent opacity-40" aria-hidden />
                <span className="relative flex shrink-0 items-center justify-center p-1" aria-hidden>
                  <span className="i-ri-information-fill size-4 text-text-accent" />
                </span>
                <div className="relative py-1 system-xs-regular text-text-secondary">
                  {t('nodes.startPlaceholder.userInputConflictTip', { ns: 'workflow' })}
                </div>
              </div>
            )}

            <div className={cn(hasUserInputNode && 'pointer-events-none opacity-30')}>
              <StartBlocks
                searchText={trimmedSearchText}
                onSelect={onSelect as OnSelectBlock}
                availableBlocksTypes={entryNodeTypes as unknown as BlockEnum[]}
                hideUserInput={!allowUserInputSelection && !hasTriggerNode}
                showMostCommonBadge
                showUserInputAdded={hasUserInputNode}
                showUserInputDisabled={hasTriggerNode && !hasUserInputNode}
                disabled={hasUserInputNode}
                onContentStateChange={handleStartBlocksContentChange}
              />

              {shouldShowInstalledTriggersDivider && (
                <SectionDivider />
              )}

              {enableTriggerPlugin && (
                <TriggerPluginList
                  onSelect={onSelect}
                  searchText={trimmedSearchText}
                  onContentStateChange={handlePluginContentChange}
                  tags={tags}
                  disabled={hasUserInputNode}
                />
              )}

              {shouldShowMarketplaceSectionDivider && (
                <SectionDivider />
              )}

              {shouldShowFeatured && (
                <FeaturedTriggers
                  plugins={featuredPlugins}
                  providerMap={providerMap}
                  onSelect={onSelect}
                  isLoading={featuredLoading}
                  onInstallSuccess={async () => {
                    invalidateTriggers()
                  }}
                />
              )}
              {enableTriggerPlugin && enable_marketplace && (
                <PluginList
                  ref={pluginRef}
                  wrapElemRef={wrapElemRef as RefObject<HTMLElement>}
                  list={marketplacePlugins}
                  searchText={trimmedSearchText}
                  category={PluginCategoryEnum.trigger}
                  tags={tags}
                  hideFindMoreFooter
                />
              )}
            </div>
          </div>

          {shouldShowEmptyState && (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
              <SearchMenu className="size-8 text-text-quaternary" />
              <div className="text-sm font-medium text-text-secondary">
                {t('nodes.startPlaceholder.noTriggersFound', { ns: 'workflow' })}
              </div>
              <Link
                href="https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml"
                target="_blank"
              >
                <Button
                  size="small"
                  variant="secondary-accent"
                  className="h-6 cursor-pointer px-3 text-xs"
                >
                  {t('tabs.requestToCommunity', { ns: 'workflow' })}
                </Button>
              </Link>
            </div>
          )}
        </div>

        {shouldShowMarketplaceFooter && (
          <Link
            className={isPanelVariant ? panelMarketplaceFooterClassName : popoverMarketplaceFooterClassName}
            href={getMarketplaceUrl('/plugins/trigger')}
            target="_blank"
          >
            {isPanelVariant
              ? (
                  <>
                    <MarketplaceFooterDivider />
                    <span className="flex items-center gap-1">
                      <span className="i-custom-vender-workflow-marketplace size-3 shrink-0" aria-hidden />
                      <span>{t('nodes.startPlaceholder.browseMoreOnMarketplace', { ns: 'workflow' })}</span>
                    </span>
                  </>
                )
              : (
                  <>
                    <span>{t('findMoreInMarketplace', { ns: 'plugin' })}</span>
                    <RiArrowRightUpLine className="ml-0.5 size-3" />
                  </>
                )}
          </Link>
        )}
      </div>
    </div>
  )
}

export default AllStartBlocks
