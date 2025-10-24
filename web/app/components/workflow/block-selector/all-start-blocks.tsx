'use client'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { BlockEnum, OnSelectBlock } from '../types'
import type { TriggerDefaultValue, TriggerWithProvider } from './types'
import StartBlocks from './start-blocks'
import TriggerPluginList from './trigger-plugin/list'
import { ENTRY_NODE_TYPES } from './constants'
import cn from '@/utils/classnames'
import Link from 'next/link'
import { RiArrowRightUpLine } from '@remixicon/react'
import { getMarketplaceUrl } from '@/utils/var'
import Button from '@/app/components/base/button'
import { SearchMenu } from '@/app/components/base/icons/src/vender/line/general'
import { BlockEnum as BlockEnumValue } from '../types'
import FeaturedTriggers from './featured-triggers'
import Divider from '@/app/components/base/divider'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useAllTriggerPlugins, useInvalidateAllTriggerPlugins } from '@/service/use-triggers'
import { useFeaturedTriggersRecommendations } from '@/service/use-plugins'

const marketplaceFooterClassName = 'system-sm-medium z-10 flex h-8 flex-none cursor-pointer items-center rounded-b-lg border-[0.5px] border-t border-components-panel-border bg-components-panel-bg-blur px-4 py-1 text-text-accent-light-mode-only shadow-lg'

type AllStartBlocksProps = {
  className?: string
  searchText: string
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  tags?: string[]
}

const AllStartBlocks = ({
  className,
  searchText,
  onSelect,
  availableBlocksTypes,
  tags = [],
}: AllStartBlocksProps) => {
  const { t } = useTranslation()
  const [hasStartBlocksContent, setHasStartBlocksContent] = useState(false)
  const [hasPluginContent, setHasPluginContent] = useState(false)
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)

  const entryNodeTypes = availableBlocksTypes?.length
    ? availableBlocksTypes
    : ENTRY_NODE_TYPES
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
  const {
    plugins: featuredPlugins = [],
    isLoading: featuredLoading,
  } = useFeaturedTriggersRecommendations(enableTriggerPlugin && enable_marketplace && !hasSearchText)

  const shouldShowFeatured = enableTriggerPlugin
    && enable_marketplace
    && !hasSearchText

  const handleStartBlocksContentChange = useCallback((hasContent: boolean) => {
    setHasStartBlocksContent(hasContent)
  }, [])

  const handlePluginContentChange = useCallback((hasContent: boolean) => {
    setHasPluginContent(hasContent)
  }, [])

  const hasAnyContent = hasStartBlocksContent || hasPluginContent || shouldShowFeatured
  const shouldShowEmptyState = hasSearchText && !hasAnyContent

  useEffect(() => {
    if (!enableTriggerPlugin && hasPluginContent)
      setHasPluginContent(false)
  }, [enableTriggerPlugin, hasPluginContent])

  return (
    <div className={cn('min-w-[400px] max-w-[500px]', className)}>
      <div className='flex max-h-[640px] flex-col'>
        <div className='flex-1 overflow-y-auto'>
          <div className={cn(shouldShowEmptyState && 'hidden')}>
            {shouldShowFeatured && (
              <>
                <FeaturedTriggers
                  plugins={featuredPlugins}
                  providerMap={providerMap}
                  onSelect={onSelect}
                  isLoading={featuredLoading}
                  onInstallSuccess={async () => {
                    invalidateTriggers()
                  }}
                />
                <div className='px-3'>
                  <Divider className='!h-px' />
                </div>
              </>
            )}
            <div className='px-3 pb-1 pt-2'>
              <span className='system-xs-medium text-text-primary'>{t('workflow.tabs.allTriggers')}</span>
            </div>
            <StartBlocks
              searchText={trimmedSearchText}
              onSelect={onSelect as OnSelectBlock}
              availableBlocksTypes={entryNodeTypes as unknown as BlockEnum[]}
              onContentStateChange={handleStartBlocksContentChange}
            />

            {enableTriggerPlugin && (
              <TriggerPluginList
                onSelect={onSelect}
                searchText={trimmedSearchText}
                onContentStateChange={handlePluginContentChange}
                tags={tags}
              />
            )}
          </div>

          {shouldShowEmptyState && (
            <div className='flex h-full flex-col items-center justify-center gap-3 py-12 text-center'>
              <SearchMenu className='h-8 w-8 text-text-quaternary' />
              <div className='text-sm font-medium text-text-secondary'>
                {t('workflow.tabs.noPluginsFound')}
              </div>
              <Link
                href='https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml'
                target='_blank'
              >
                <Button
                  size='small'
                  variant='secondary-accent'
                  className='h-6 cursor-pointer px-3 text-xs'
                >
                  {t('workflow.tabs.requestToCommunity')}
                </Button>
              </Link>
            </div>
          )}
        </div>

        {!shouldShowEmptyState && (
          // Footer - Same as Tools tab marketplace footer
          <Link
            className={marketplaceFooterClassName}
            href={getMarketplaceUrl('')}
            target='_blank'
          >
            <span>{t('plugin.findMoreInMarketplace')}</span>
            <RiArrowRightUpLine className='ml-0.5 h-3 w-3' />
          </Link>
        )}
      </div>
    </div>
  )
}

export default AllStartBlocks
