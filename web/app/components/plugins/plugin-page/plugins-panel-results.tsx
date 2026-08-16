import type { RefObject } from 'react'
import type { PluginDetail } from '../types'
import type { EmbeddedMarketplaceCategory } from './category-marketplace'
import type { PluginPageContentInset } from './content-inset'
import type { Collection } from '@/app/components/tools/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import IntegrationsToolProviderCard from '@/app/components/integrations/tool-provider-card'
import { BuiltinMarketplacePanel } from '@/app/components/tools/marketplace/builtin-marketplace-panel'
import CategoryEmptyState from './category-empty-state'
import CategoryMarketplacePanel from './category-marketplace-panel'
import List from './list'

type PluginsPanelResultsProps = {
  autoLoadNextPage: boolean
  canDeletePlugin: boolean
  canUpdatePlugin: boolean
  categoryEmptyState?: EmbeddedMarketplaceCategory
  categoryMarketplace?: EmbeddedMarketplaceCategory
  containerRef: RefObject<HTMLDivElement | null>
  contentFrameClassName: string
  contentInset: PluginPageContentInset
  currentBuiltinToolID?: string
  firstBuiltinToolTarget?: string
  firstPluginTarget?: string
  filteredBuiltinTools: Collection[]
  filteredList: Array<PluginDetail & { latest_version: string }>
  hasToolMarketplacePanel: boolean
  hasVisibleBuiltinTools: boolean
  hasVisiblePlugins: boolean
  hasEmbeddedMarketplace: boolean
  isFetching: boolean
  isLastPage: boolean
  keywords: string
  loadNextPage: () => void
  scrollAreaLabel?: string
  setCurrentBuiltinToolID: (id: string) => void
  showCategoryEmptyState: boolean
  tagFilterValue: string[]
}

const PluginsPanelResults = ({
  autoLoadNextPage,
  canDeletePlugin,
  canUpdatePlugin,
  categoryEmptyState,
  categoryMarketplace,
  containerRef,
  contentFrameClassName,
  contentInset,
  currentBuiltinToolID,
  firstBuiltinToolTarget,
  firstPluginTarget,
  filteredBuiltinTools,
  filteredList,
  hasToolMarketplacePanel,
  hasVisibleBuiltinTools,
  hasVisiblePlugins,
  hasEmbeddedMarketplace,
  isFetching,
  isLastPage,
  keywords,
  loadNextPage,
  scrollAreaLabel,
  setCurrentBuiltinToolID,
  showCategoryEmptyState,
  tagFilterValue,
}: PluginsPanelResultsProps) => {
  const { t } = useTranslation()
  const loadMoreAnchorRef = useRef<HTMLDivElement>(null)
  const loadNextPageRequestedRef = useRef(false)

  useEffect(() => {
    const anchor = loadMoreAnchorRef.current
    const root = containerRef.current

    if (!isFetching) loadNextPageRequestedRef.current = false

    if (
      !autoLoadNextPage ||
      !anchor ||
      !root ||
      isFetching ||
      isLastPage ||
      !globalThis.IntersectionObserver
    )
      return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadNextPageRequestedRef.current) return

        loadNextPageRequestedRef.current = true
        loadNextPage()
      },
      {
        root,
        rootMargin: '200px',
        threshold: 0.1,
      },
    )

    observer.observe(anchor)
    return () => observer.disconnect()
  }, [autoLoadNextPage, containerRef, isFetching, isLastPage, loadNextPage])

  return (
    <ScrollArea
      className={cn(
        'min-h-0 grow self-stretch overflow-hidden bg-components-panel-bg',
        contentFrameClassName,
      )}
    >
      <ScrollAreaViewport
        ref={containerRef}
        aria-label={scrollAreaLabel}
        className="overscroll-contain"
        role={scrollAreaLabel ? 'region' : undefined}
      >
        <ScrollAreaContent
          className={cn('flex min-h-full flex-col', hasEmbeddedMarketplace && 'pt-1')}
        >
          {showCategoryEmptyState && categoryEmptyState && (
            <CategoryEmptyState
              category={categoryEmptyState}
              showMarketplaceLink={!!categoryMarketplace}
            />
          )}
          {(hasVisiblePlugins || hasVisibleBuiltinTools) && (
            <List
              pluginList={filteredList}
              canDeletePlugin={canDeletePlugin}
              canUpdatePlugin={canUpdatePlugin}
              firstPluginTarget={firstPluginTarget}
            >
              {filteredBuiltinTools.map((collection, index) => (
                <button
                  key={collection.id}
                  type="button"
                  aria-pressed={currentBuiltinToolID === collection.id}
                  className="min-w-0 cursor-pointer appearance-none border-0 bg-transparent p-0 text-left"
                  data-step-by-step-tour-target={
                    filteredList.length === 0 && index === 0 ? firstBuiltinToolTarget : undefined
                  }
                  onClick={() => setCurrentBuiltinToolID(collection.id)}
                >
                  <IntegrationsToolProviderCard
                    collection={collection}
                    current={currentBuiltinToolID === collection.id}
                    showBuiltInBadge
                  />
                </button>
              ))}
            </List>
          )}
          {!isLastPage && (
            <div className="flex w-full justify-center py-4">
              {isFetching ? (
                <Loading className="size-8" />
              ) : autoLoadNextPage ? null : (
                <Button onClick={loadNextPage}>
                  {t(($) => $['common.loadMore'], { ns: 'workflow' })}
                </Button>
              )}
              {autoLoadNextPage && (
                <div ref={loadMoreAnchorRef} className="h-px w-full" aria-hidden />
              )}
            </div>
          )}
          {hasToolMarketplacePanel && (
            <BuiltinMarketplacePanel
              containerRef={containerRef}
              contentInset={contentInset}
              keywords={keywords}
              tagFilterValue={tagFilterValue}
            />
          )}
          {categoryMarketplace && (
            <CategoryMarketplacePanel
              category={categoryMarketplace}
              searchText={keywords}
              tags={categoryMarketplace === 'trigger' ? tagFilterValue : []}
            />
          )}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )
}

export default PluginsPanelResults
