import type { RefObject } from 'react'
import type { PluginDetail } from '../types'
import type { PluginPageContentInset } from './content-inset'
import type { Collection } from '@/app/components/tools/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useToolMarketplacePanel } from '@/app/components/integrations/hooks/use-tool-marketplace-panel'
import IntegrationsToolProviderCard from '@/app/components/integrations/tool-provider-card'
import Marketplace from '@/app/components/tools/marketplace'
import List from './list'

type BuiltinMarketplacePanelProps = {
  containerRef: RefObject<HTMLDivElement | null>
  contentInset: PluginPageContentInset
  keywords: string
  tagFilterValue: string[]
}

const BuiltinMarketplacePanel = ({
  containerRef,
  contentInset,
  keywords,
  tagFilterValue,
}: BuiltinMarketplacePanelProps) => {
  const {
    isMarketplaceArrowVisible,
    marketplaceContext,
    showMarketplacePanel,
    toolListTailRef,
  } = useToolMarketplacePanel({
    containerRef,
    keywords,
    tagFilterValue,
  })

  return (
    <>
      <div ref={toolListTailRef} />
      <Marketplace
        searchPluginText={keywords}
        filterPluginTags={tagFilterValue}
        isMarketplaceArrowVisible={isMarketplaceArrowVisible}
        showMarketplacePanel={showMarketplacePanel}
        marketplaceContext={marketplaceContext}
        contentInset={contentInset}
      />
    </>
  )
}

type PluginsPanelResultsProps = {
  canDeletePlugin: boolean
  canUpdatePlugin: boolean
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
  isAgentStrategyIntegrationPage: boolean
  isFetching: boolean
  isLastPage: boolean
  keywords: string
  loadNextPage: () => void
  scrollAreaLabel?: string
  setCurrentBuiltinToolID: (id: string) => void
  tagFilterValue: string[]
}

const PluginsPanelResults = ({
  canDeletePlugin,
  canUpdatePlugin,
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
  isAgentStrategyIntegrationPage,
  isFetching,
  isLastPage,
  keywords,
  loadNextPage,
  scrollAreaLabel,
  setCurrentBuiltinToolID,
  tagFilterValue,
}: PluginsPanelResultsProps) => {
  const { t } = useTranslation()

  return (
    <ScrollAreaRoot
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
          className={cn(
            'flex min-h-full flex-col',
            isAgentStrategyIntegrationPage && 'pt-2',
          )}
        >
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
                  data-step-by-step-tour-target={filteredList.length === 0 && index === 0 ? firstBuiltinToolTarget : undefined}
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
              {isFetching
                ? <Loading className="size-8" />
                : (
                    <Button onClick={loadNextPage}>
                      {t('common.loadMore', { ns: 'workflow' })}
                    </Button>
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
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  )
}

export default PluginsPanelResults
