'use client'
import type { ReactNode, RefObject } from 'react'
import type { ToolCategory } from '@/app/components/integrations/routes'
import type { ToolsContentInset } from '@/app/components/tools/content-inset'
import type { Collection } from '@/app/components/tools/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isSearchResultEmpty } from '@/app/components/base/search-input/search-state'
import { useTags } from '@/app/components/plugins/hooks'
import Empty from '@/app/components/plugins/marketplace/empty'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from '@/app/components/tools/content-inset'
import { useCanManageMCP, useCanManageTools } from '@/app/components/tools/hooks/use-tool-permissions'
import Marketplace from '@/app/components/tools/marketplace'
import MCPList from '@/app/components/tools/mcp'
import ProviderDetail from '@/app/components/tools/provider/detail'
import { ToolProviderGrid } from '@/app/components/tools/tool-provider-grid'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useCheckInstalled, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { useAllToolProviders } from '@/service/use-tools'
import { useToolMarketplacePanel } from './hooks/use-tool-marketplace-panel'
import { useToolProviderCategory } from './hooks/use-tool-provider-category'
import ToolProviderCreateAction from './tool-provider-create-action'
import { ToolProviderToolbar } from './tool-provider-toolbar'

type ProviderListProps = {
  category?: ToolCategory
  contentInset?: ToolsContentInset
  layout?: (parts: { body: ReactNode, toolbar: ReactNode }) => ReactNode
}

type BuiltinMarketplacePanelProps = {
  containerRef: RefObject<HTMLDivElement | null>
  contentInset: ToolsContentInset
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

const ProviderList = ({
  category,
  contentInset = 'default',
  layout,
}: ProviderListProps) => {
  // const searchParams = useSearchParams()
  // searchParams.get('category') === 'workflow'
  const { t } = useTranslation()
  const { getTagLabel } = useTags()
  const {
    canDeletePlugin,
    canSetPluginPreferences,
    canUpdatePlugin,
  } = usePluginSettingsAccess()
  const canManageTools = useCanManageTools()
  const canManageMCP = useCanManageMCP()
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { activeTab, handleCategoryChange, isRouteCategory } = useToolProviderCategory(category)
  const contentPaddingClassName = toolsContentInsetClassNames[contentInset]
  const toolListFrameClassName = cn(contentPaddingClassName, toolsUnifiedContentFrameClassName)
  const showToolsUpdateSetting = activeTab === 'builtin' && canSetPluginPreferences
  const showLabelFilter = activeTab === 'builtin'
  const options = [
    { value: 'builtin', text: t('type.builtIn', { ns: 'tools' }) },
    { value: 'api', text: t('type.custom', { ns: 'tools' }) },
    { value: 'workflow', text: t('type.workflow', { ns: 'tools' }) },
    { value: 'mcp', text: 'MCP' },
  ]
  const [tagFilterValue, setTagFilterValue] = useState<string[]>([])
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
  }
  const [keywords, setKeywords] = useState<string>('')
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
  }
  const [createdMCPProviderId, setCreatedMCPProviderId] = useState<string>()
  const handleMCPProviderCreated = useCallback((providerId: string) => {
    setCreatedMCPProviderId(providerId)
  }, [])
  const handleCreatedMCPProviderHandled = useCallback(() => {
    setCreatedMCPProviderId(undefined)
  }, [])
  const { data: collectionList = [], isLoading: isCollectionListLoading, refetch } = useAllToolProviders()
  const activeTabCollectionList = useMemo(() => {
    return collectionList.filter(collection => collection.type === activeTab)
  }, [activeTab, collectionList])
  const hasCategoryCollections = activeTabCollectionList.length > 0
  const shouldShowCustomToolCreateCard = canManageTools && !(activeTab === 'api' && !isCollectionListLoading && hasCategoryCollections)
  const shouldShowMCPCreateCard = canManageMCP && !(activeTab === 'mcp' && hasCategoryCollections)
  const shouldShowToolbarCreateAction
    = (activeTab === 'mcp' && canManageMCP && hasCategoryCollections)
      || (activeTab === 'api' && canManageTools && !isCollectionListLoading && hasCategoryCollections)
  const filteredCollectionList = useMemo(() => {
    return activeTabCollectionList.filter((collection) => {
      if (showLabelFilter && tagFilterValue.length > 0 && (!collection.labels || collection.labels.every(label => !tagFilterValue.includes(label))))
        return false
      if (keywords)
        return Object.values(collection.label).some(value => value.toLowerCase().includes(keywords.toLowerCase()))
      return true
    })
  }, [activeTabCollectionList, showLabelFilter, tagFilterValue, keywords])
  const isFilteringCollections = !!keywords.trim() || (showLabelFilter && tagFilterValue.length > 0)
  const isCollectionSearchEmpty = isSearchResultEmpty({
    hasActiveFilter: isFilteringCollections,
    isLoading: isCollectionListLoading,
    resultCount: filteredCollectionList.length,
    sourceCount: activeTabCollectionList.length,
  })

  const [currentProviderId, setCurrentProviderId] = useState<string | undefined>()
  const currentProvider = useMemo<Collection | undefined>(() => {
    return filteredCollectionList.find(collection => collection.id === currentProviderId)
  }, [currentProviderId, filteredCollectionList])
  const { data: checkedInstalledData } = useCheckInstalled({
    pluginIds: currentProvider?.plugin_id ? [currentProvider.plugin_id] : [],
    enabled: !!currentProvider?.plugin_id,
  })
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginDetail = useMemo(() => {
    return checkedInstalledData?.plugins?.[0]
  }, [checkedInstalledData])
  const containerRef = useRef<HTMLDivElement>(null)

  const toolbar = (
    <ToolProviderToolbar
      activeTab={activeTab}
      currentProviderId={currentProviderId}
      frameClassName={layout ? undefined : toolListFrameClassName}
      isRouteCategory={isRouteCategory}
      keywords={keywords}
      options={options}
      showLabelFilter={showLabelFilter}
      showToolsUpdateSetting={showToolsUpdateSetting}
      tagFilterValue={tagFilterValue}
      toolbarAction={shouldShowToolbarCreateAction
        ? (
            <ToolProviderCreateAction
              activeTab={activeTab}
              hasCategoryCollections={hasCategoryCollections}
              isCollectionListLoading={isCollectionListLoading}
              onCustomToolCreated={refetch}
              onMCPProviderCreated={handleMCPProviderCreated}
            />
          )
        : undefined}
      onCategoryChange={state => handleCategoryChange(state, () => setCurrentProviderId(undefined))}
      onKeywordsChange={handleKeywordsChange}
      onTagsChange={handleTagsChange}
    />
  )

  const body = (
    <>
      <div className="relative flex h-0 shrink-0 grow flex-col overflow-hidden bg-components-panel-bg">
        <ScrollAreaRoot className="relative min-h-0 grow overflow-hidden bg-components-panel-bg">
          <ScrollAreaViewport
            ref={containerRef}
            aria-label={t('menus.tools', { ns: 'common' })}
            className="overscroll-contain"
            role="region"
          >
            <ScrollAreaContent className="flex min-h-full flex-col">
              {activeTab !== 'mcp' && (
                <ToolProviderGrid
                  activeTab={activeTab}
                  collections={filteredCollectionList}
                  currentProviderId={currentProviderId}
                  frameClassName={toolListFrameClassName}
                  getTagLabel={getTagLabel}
                  hasCategoryCollections={activeTabCollectionList.length > 0}
                  isLoading={isCollectionListLoading}
                  useIntegrationsCard={contentInset === 'compact'}
                  isSearchResultEmpty={isCollectionSearchEmpty}
                  showCreateCard={shouldShowCustomToolCreateCard}
                  onRefreshData={refetch}
                  onSelectProvider={setCurrentProviderId}
                />
              )}
              {!isCollectionListLoading && !activeTabCollectionList.length && activeTab === 'builtin' && (
                <Empty lightCard text={t('noTools', { ns: 'tools' })} className={cn('h-[224px] shrink-0', toolListFrameClassName)} />
              )}
              {isCollectionSearchEmpty && activeTab === 'builtin' && (
                <div className={cn('h-[224px] shrink-0', toolListFrameClassName)} />
              )}
              {enable_marketplace && activeTab === 'builtin' && (
                <BuiltinMarketplacePanel
                  containerRef={containerRef}
                  contentInset={contentInset}
                  keywords={keywords}
                  tagFilterValue={tagFilterValue}
                />
              )}
              {activeTab === 'mcp' && (
                <MCPList
                  searchText={keywords}
                  contentInset={contentInset}
                  createdProviderId={createdMCPProviderId}
                  showCreateCard={shouldShowMCPCreateCard}
                  onCreatedProviderHandled={handleCreatedMCPProviderHandled}
                />
              )}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </div>
      {currentProvider && !currentProvider.plugin_id && (
        <ProviderDetail
          collection={currentProvider}
          onHide={() => setCurrentProviderId(undefined)}
          onRefreshData={refetch}
        />
      )}
      <PluginDetailPanel
        detail={currentPluginDetail}
        onUpdate={() => invalidateInstalledPluginList()}
        onHide={() => setCurrentProviderId(undefined)}
        canDeletePlugin={canDeletePlugin}
        canUpdatePlugin={canUpdatePlugin}
      />
    </>
  )

  if (layout)
    return layout({ body, toolbar })

  return (
    <>
      {toolbar}
      {body}
    </>
  )
}
ProviderList.displayName = 'ToolProviderList'
export default ProviderList
