'use client'
import type { ReactNode } from 'react'
import type { PluginDetail } from '../types'
import type { PluginPageContentInset } from './content-inset'
import type { FilterState } from './filter-management'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isSearchResultEmpty } from '@/app/components/base/search-input/search-state'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import ProviderDetail from '@/app/components/tools/provider/detail'
import { useGetLanguage } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { renderI18nObject } from '@/i18n-config'
import { useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { usePluginsWithLatestVersion } from '../hooks'
import { PluginCategoryEnum } from '../types'
import { pluginPageContentFrameClassNames, pluginPageContentInsetClassNames } from './content-inset'
import { usePluginPageContext } from './context'
import Empty from './empty'
import FilterManagement from './filter-management'
import PluginListSkeleton from './plugin-list-skeleton'
import PluginsPanelResults from './plugins-panel-results'
import { EMPTY_BUILTIN_TOOLS, filterBuiltinTools } from './plugins-panel-utils'

const matchesSearchQuery = (plugin: PluginDetail & { latest_version: string }, query: string, locale: string): boolean => {
  if (!query)
    return true
  const lowerQuery = query.toLowerCase()
  const { declaration } = plugin
  // Match plugin_id
  if (plugin.plugin_id.toLowerCase().includes(lowerQuery))
    return true
  // Match plugin name
  if (plugin.name?.toLowerCase().includes(lowerQuery))
    return true
  // Match declaration name
  if (declaration.name?.toLowerCase().includes(lowerQuery))
    return true
  // Match localized label
  const label = renderI18nObject(declaration.label, locale)
  if (label?.toLowerCase().includes(lowerQuery))
    return true
  // Match localized description
  const description = renderI18nObject(declaration.description, locale)
  if (description?.toLowerCase().includes(lowerQuery))
    return true
  return false
}

type PluginsPanelProps = {
  canInstall?: boolean
  canDeletePlugin?: boolean
  canUpdatePlugin?: boolean
  contentInset?: PluginPageContentInset
  fixedCategory?: PluginCategoryEnum
  layout?: (parts: { body: ReactNode, toolbar: ReactNode }) => ReactNode
  onSwitchToMarketplace?: () => void
  toolbarAction?: ReactNode
}

const PluginsPanel = ({
  canInstall = true,
  canDeletePlugin = true,
  canUpdatePlugin = true,
  contentInset = 'default',
  fixedCategory,
  layout,
  onSwitchToMarketplace,
  toolbarAction,
}: PluginsPanelProps) => {
  const { t } = useTranslation()
  const locale = useGetLanguage()
  const filters = usePluginPageContext(v => v.filters) as FilterState
  const setFilters = usePluginPageContext(v => v.setFilters)
  const isToolIntegrationPage = fixedCategory === PluginCategoryEnum.tool
  const isTriggerIntegrationPage = fixedCategory === PluginCategoryEnum.trigger
  const isAgentStrategyIntegrationPage = fixedCategory === PluginCategoryEnum.agent
  const isExtensionIntegrationPage = fixedCategory === PluginCategoryEnum.extension
  const isIntegrationCategoryPage = isToolIntegrationPage || isTriggerIntegrationPage || isAgentStrategyIntegrationPage || isExtensionIntegrationPage
  const supportsTagFilter = !fixedCategory || isToolIntegrationPage || isTriggerIntegrationPage
  const { data: enableMarketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { data: pluginList, isLoading: isPluginListLoading, isFetching, isLastPage, loadNextPage } = useInstalledPluginList(
    false,
    100,
    fixedCategory
      ? {
          category: fixedCategory,
          refetchOnMount: isIntegrationCategoryPage ? 'always' : undefined,
        }
      : undefined,
  )
  const pluginListWithLatestVersion = usePluginsWithLatestVersion(pluginList?.plugins)
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginID = usePluginPageContext(v => v.currentPluginID)
  const setCurrentPluginID = usePluginPageContext(v => v.setCurrentPluginID)
  const [currentBuiltinToolID, setCurrentBuiltinToolID] = useState<string | undefined>()
  const containerRef = useRef<HTMLDivElement>(null)

  const { run: handleFilterChange } = useDebounceFn((filters: FilterState) => {
    setFilters(filters)
  }, { wait: 500 })

  const categoryList = useMemo(() => {
    if (!fixedCategory)
      return pluginListWithLatestVersion

    return pluginListWithLatestVersion.filter(plugin => plugin.declaration.category === fixedCategory)
  }, [fixedCategory, pluginListWithLatestVersion])

  const filteredList = useMemo(() => {
    const { categories, searchQuery, tags } = filters
    const filteredList = categoryList.filter((plugin) => {
      return (
        (fixedCategory || categories.length === 0 || categories.includes(plugin.declaration.category))
        && (!supportsTagFilter || tags.length === 0 || tags.some(tag => plugin.declaration.tags.includes(tag)))
        && matchesSearchQuery(plugin, searchQuery, locale)
      )
    })
    return filteredList
  }, [categoryList, fixedCategory, supportsTagFilter, filters, locale])
  const builtinTools = isToolIntegrationPage ? pluginList?.builtin_tools ?? EMPTY_BUILTIN_TOOLS : EMPTY_BUILTIN_TOOLS
  const filteredBuiltinTools = useMemo(() => {
    if (!isToolIntegrationPage)
      return []

    return filterBuiltinTools(builtinTools, filters.searchQuery, locale, filters.tags)
  }, [builtinTools, filters.searchQuery, filters.tags, isToolIntegrationPage, locale])
  const hasVisiblePlugins = (filteredList?.length ?? 0) > 0
  const hasVisibleBuiltinTools = filteredBuiltinTools.length > 0
  const isFilteringCategory = !!filters.searchQuery.trim() || (supportsTagFilter && filters.tags.length > 0)
  const isIntegrationCategorySearchEmpty = isIntegrationCategoryPage && isSearchResultEmpty({
    hasActiveFilter: isFilteringCategory,
    isLoading: isPluginListLoading,
    resultCount: filteredList.length + filteredBuiltinTools.length,
    sourceCount: categoryList.length + builtinTools.length,
  })

  const currentPluginDetail = useMemo(() => {
    const detail = pluginListWithLatestVersion.find(plugin => plugin.plugin_id === currentPluginID)
    return detail
  }, [currentPluginID, pluginListWithLatestVersion])
  const currentBuiltinTool = useMemo(() => {
    return filteredBuiltinTools.find(collection => collection.id === currentBuiltinToolID)
  }, [currentBuiltinToolID, filteredBuiltinTools])

  const handleHide = () => setCurrentPluginID(undefined)
  const handleBuiltinToolHide = () => setCurrentBuiltinToolID(undefined)
  const hasToolMarketplacePanel = enableMarketplace && isToolIntegrationPage
  const contentPaddingClassName = pluginPageContentInsetClassNames[contentInset]
  const contentFrameClassName = cn(
    pluginPageContentFrameClassNames[contentInset],
    contentPaddingClassName,
  )
  const emptyVariant = isTriggerIntegrationPage
    ? 'integrationsTrigger'
    : isAgentStrategyIntegrationPage
      ? 'integrationsAgentStrategy'
      : isExtensionIntegrationPage
        ? 'integrationsExtension'
        : 'default'
  const scrollAreaLabel = isTriggerIntegrationPage
    ? t($ => $['categorySingle.trigger'], { ns: 'plugin' })
    : isAgentStrategyIntegrationPage
      ? t($ => $['categorySingle.agent'], { ns: 'plugin' })
      : isExtensionIntegrationPage
        ? t($ => $['categorySingle.extension'], { ns: 'plugin' })
        : isToolIntegrationPage
          ? t($ => $['categorySingle.tool'], { ns: 'plugin' })
          : undefined
  const resultTarget = isTriggerIntegrationPage
    ? STEP_BY_STEP_TOUR_TARGETS.integrationTriggerGrid
    : isAgentStrategyIntegrationPage
      ? STEP_BY_STEP_TOUR_TARGETS.integrationAgentStrategyEmpty
      : isExtensionIntegrationPage
        ? STEP_BY_STEP_TOUR_TARGETS.integrationExtensionGrid
        : undefined

  const toolbar = (
    <div className={cn(
      layout
        ? 'flex w-full items-center bg-components-panel-bg'
        : [
            isIntegrationCategoryPage
              ? 'flex h-12 shrink-0 items-center bg-components-panel-bg py-2'
              : 'sticky top-0 z-10 flex flex-col items-start justify-center gap-3 self-stretch bg-components-panel-bg pt-1 pb-3',
            contentFrameClassName,
          ],
    )}
    >
      {!layout && !isIntegrationCategoryPage && <div className="h-px self-stretch bg-divider-subtle"></div>}
      <FilterManagement
        hideCategoryFilter={!!fixedCategory}
        hideTagFilter={!supportsTagFilter}
        onFilterChange={handleFilterChange}
        rightSlot={toolbarAction}
      />
    </div>
  )

  const body = (
    <>
      {isPluginListLoading && <PluginListSkeleton contentFrameClassName={contentFrameClassName} />}
      {!isPluginListLoading && (
        <>
          {hasVisiblePlugins || hasVisibleBuiltinTools || hasToolMarketplacePanel
            ? (
                <PluginsPanelResults
                  containerRef={containerRef}
                  contentFrameClassName={contentFrameClassName}
                  contentInset={contentInset}
                  currentBuiltinToolID={currentBuiltinToolID}
                  firstBuiltinToolTarget={isToolIntegrationPage ? STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginFirstCard : undefined}
                  firstPluginTarget={isToolIntegrationPage ? STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginFirstCard : resultTarget}
                  filteredBuiltinTools={filteredBuiltinTools}
                  filteredList={filteredList}
                  hasToolMarketplacePanel={hasToolMarketplacePanel}
                  hasVisibleBuiltinTools={hasVisibleBuiltinTools}
                  hasVisiblePlugins={hasVisiblePlugins}
                  isAgentStrategyIntegrationPage={isAgentStrategyIntegrationPage}
                  isFetching={isFetching}
                  isLastPage={isLastPage}
                  keywords={filters.searchQuery}
                  loadNextPage={loadNextPage}
                  scrollAreaLabel={scrollAreaLabel}
                  setCurrentBuiltinToolID={setCurrentBuiltinToolID}
                  tagFilterValue={filters.tags}
                  canDeletePlugin={canDeletePlugin}
                  canUpdatePlugin={canUpdatePlugin}
                />
              )
            : isIntegrationCategorySearchEmpty
              ? (
                  <div className={cn('min-h-0 grow bg-components-panel-bg', contentFrameClassName)} />
                )
              : (
                  <Empty
                    canInstall={canInstall}
                    contentInset={contentInset}
                    onSwitchToMarketplace={onSwitchToMarketplace}
                    installContextCategory={fixedCategory}
                    variant={emptyVariant}
                  />
                )}
        </>
      )}
    </>
  )

  return (
    <>
      {layout
        ? layout({ body, toolbar })
        : (
            <>
              {toolbar}
              {body}
            </>
          )}
      <PluginDetailPanel
        detail={currentPluginDetail}
        onUpdate={() => invalidateInstalledPluginList()}
        onHide={handleHide}
        canDeletePlugin={canDeletePlugin}
        canUpdatePlugin={canUpdatePlugin}
      />
      {currentBuiltinTool && !currentBuiltinTool.plugin_id && (
        <ProviderDetail
          collection={currentBuiltinTool}
          onHide={handleBuiltinToolHide}
          onRefreshData={invalidateInstalledPluginList}
        />
      )}
    </>
  )
}

export default PluginsPanel
