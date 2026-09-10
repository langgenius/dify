'use client'
import type { ActivePluginType } from '../constants'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import Loading from '@/app/components/base/loading'
import {
  flushMarketplaceSiteFilter,
  flushMarketplaceSiteSearch,
  markMarketplaceSiteSearch,
} from '@/utils/marketplace-site-track'
import { useSearchPluginText } from '../atoms'
import SortDropdown from '../sort-dropdown'
import { useMarketplaceData } from '../state'
import List from './index'

type ListWrapperProps = {
  activePluginType?: ActivePluginType
  className?: string
  deferOffscreenCollections?: boolean
  showInstallButton?: boolean
  linkToMarketplaceDetail?: boolean
}
const ListWrapper = ({
  activePluginType,
  className,
  deferOffscreenCollections,
  showInstallButton,
  linkToMarketplaceDetail,
}: ListWrapperProps) => {
  const { t } = useTranslation()

  const {
    plugins,
    pluginsTotal,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    isLoading,
    isRefreshing,
    isError,
    refetch,
    isFetchingNextPage,
    page,
  } = useMarketplaceData(activePluginType)
  const [searchPluginText] = useSearchPluginText()
  const previousSearchRef = useRef(searchPluginText)
  const isFirstSearchRender = useRef(true)

  useEffect(() => {
    if (isFirstSearchRender.current) {
      isFirstSearchRender.current = false
      previousSearchRef.current = searchPluginText
      return
    }

    if (searchPluginText && searchPluginText !== previousSearchRef.current)
      markMarketplaceSiteSearch(searchPluginText)

    previousSearchRef.current = searchPluginText
  }, [searchPluginText])

  useEffect(() => {
    if (isLoading || isError || pluginsTotal === undefined) return

    flushMarketplaceSiteSearch(pluginsTotal)
    flushMarketplaceSiteFilter(pluginsTotal)
  }, [isLoading, isError, pluginsTotal])

  return (
    <div
      style={{
        // The first live-search response inserts the result summary above the
        // existing grid. Keep Chromium from treating a card in this dynamic
        // region as the scroll anchor and compensating by moving the page.
        overflowAnchor: 'none',
        scrollbarGutter: 'stable',
        paddingBottom: 'calc(0.5rem + var(--marketplace-header-collapse-offset, 0px))',
      }}
      className={cn(
        'relative flex grow flex-col bg-background-default-subtle px-8 py-2',
        className,
      )}
    >
      <div className="flex w-full grow flex-col">
        {plugins && (
          <div className="mb-4 flex items-center pt-3">
            <div className="title-xl-semi-bold text-text-primary">
              {t(($) => $['marketplace.pluginsResult'], { ns: 'plugin', num: pluginsTotal })}
            </div>
            <div className="mx-3 h-3.5 w-px bg-divider-regular"></div>
            <SortDropdown />
          </div>
        )}
        {isError && !plugins?.length ? (
          <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-sm text-text-tertiary">
            <span>{t(($) => $['marketplace.loadError'], { ns: 'plugin' })}</span>
            <Button size="small" variant="secondary" onClick={() => void refetch()}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        ) : (
          // Rendered even while a superseded query is in flight: unmounting
          // the grid collapsed the container and jumped the scroll position
          // on every search keystroke. `isRefreshing` dims it instead.
          <div
            className={cn(
              'flex grow flex-col transition-opacity duration-150',
              isRefreshing && 'opacity-60',
            )}
            aria-busy={isRefreshing || undefined}
          >
            <List
              marketplaceCollections={marketplaceCollections || []}
              marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap || {}}
              plugins={plugins}
              deferOffscreenCollections={deferOffscreenCollections}
              showInstallButton={showInstallButton}
              linkToMarketplaceDetail={linkToMarketplaceDetail}
              cardSection={searchPluginText ? 'search' : 'list'}
            />
          </div>
        )}
      </div>
      {isLoading && page === 1 && (
        <div className="absolute top-1/2 left-1/2 -translate-1/2">
          <Loading />
        </div>
      )}
      {isFetchingNextPage && <Loading className="my-3" />}
    </div>
  )
}

export default ListWrapper
