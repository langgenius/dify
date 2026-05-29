'use client'
import type { ReactNode } from 'react'
import type { PluginDetail } from '../types'
import type { PluginPageContentInset } from './content-inset'
import type { FilterState } from './filter-management'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useDebounceFn } from 'ahooks'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { isSearchResultEmpty } from '@/app/components/base/search-input/search-state'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n-config'
import { useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { usePluginsWithLatestVersion } from '../hooks'
import { PluginCategoryEnum } from '../types'
import { pluginPageContentFrameClassNames, pluginPageContentInsetClassNames } from './content-inset'
import { usePluginPageContext } from './context'
import Empty from './empty'
import FilterManagement from './filter-management'
import List from './list'

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
  contentInset?: PluginPageContentInset
  fixedCategory?: PluginCategoryEnum
  onSwitchToMarketplace?: () => void
  toolbarAction?: ReactNode
}

const PluginsPanel = ({
  canInstall = true,
  contentInset = 'default',
  fixedCategory,
  onSwitchToMarketplace,
  toolbarAction,
}: PluginsPanelProps) => {
  const { t } = useTranslation()
  const locale = useGetLanguage()
  const filters = usePluginPageContext(v => v.filters) as FilterState
  const setFilters = usePluginPageContext(v => v.setFilters)
  const isTriggerIntegrationPage = fixedCategory === PluginCategoryEnum.trigger
  const isAgentStrategyIntegrationPage = fixedCategory === PluginCategoryEnum.agent
  const isExtensionIntegrationPage = fixedCategory === PluginCategoryEnum.extension
  const isIntegrationCategoryPage = isTriggerIntegrationPage || isAgentStrategyIntegrationPage || isExtensionIntegrationPage
  const { data: pluginList, isLoading: isPluginListLoading, isFetching, isLastPage, loadNextPage } = useInstalledPluginList(
    undefined,
    100,
    isIntegrationCategoryPage ? { refetchOnMount: 'always' } : undefined,
  )
  const pluginListWithLatestVersion = usePluginsWithLatestVersion(pluginList?.plugins)
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginID = usePluginPageContext(v => v.currentPluginID)
  const setCurrentPluginID = usePluginPageContext(v => v.setCurrentPluginID)

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
    const shouldApplyTagFilter = !fixedCategory || isTriggerIntegrationPage
    const filteredList = categoryList.filter((plugin) => {
      return (
        (fixedCategory || categories.length === 0 || categories.includes(plugin.declaration.category))
        && (!shouldApplyTagFilter || tags.length === 0 || tags.some(tag => plugin.declaration.tags.includes(tag)))
        && matchesSearchQuery(plugin, searchQuery, locale)
      )
    })
    return filteredList
  }, [categoryList, fixedCategory, isTriggerIntegrationPage, filters, locale])
  const isFilteringCategory = !!filters.searchQuery.trim() || (isTriggerIntegrationPage && filters.tags.length > 0)
  const isIntegrationCategorySearchEmpty = isIntegrationCategoryPage && isSearchResultEmpty({
    hasActiveFilter: isFilteringCategory,
    isLoading: isPluginListLoading,
    resultCount: filteredList.length,
    sourceCount: categoryList.length,
  })

  const currentPluginDetail = useMemo(() => {
    const detail = pluginListWithLatestVersion.find(plugin => plugin.plugin_id === currentPluginID)
    return detail
  }, [currentPluginID, pluginListWithLatestVersion])

  const handleHide = () => setCurrentPluginID(undefined)
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
    ? t('categorySingle.trigger', { ns: 'plugin' })
    : isAgentStrategyIntegrationPage
      ? t('categorySingle.agent', { ns: 'plugin' })
      : isExtensionIntegrationPage
        ? t('categorySingle.extension', { ns: 'plugin' })
        : undefined

  return (
    <>
      <div className={cn(
        isIntegrationCategoryPage
          ? 'flex h-12 shrink-0 items-center bg-components-panel-bg py-2'
          : 'sticky top-0 z-10 flex flex-col items-start justify-center gap-3 self-stretch bg-components-panel-bg pt-1 pb-3',
        contentFrameClassName,
      )}
      >
        {!isIntegrationCategoryPage && <div className="h-px self-stretch bg-divider-subtle"></div>}
        <FilterManagement
          hideCategoryFilter={!!fixedCategory}
          hideTagFilter={!!fixedCategory && !isTriggerIntegrationPage}
          onFilterChange={handleFilterChange}
          rightSlot={toolbarAction}
        />
      </div>
      {isPluginListLoading && <Loading type="app" />}
      {!isPluginListLoading && (
        <>
          {(filteredList?.length ?? 0) > 0
            ? (
                <ScrollArea
                  className={cn(
                    'min-h-0 grow self-stretch overflow-hidden bg-components-panel-bg',
                    contentFrameClassName,
                  )}
                  label={scrollAreaLabel}
                  slotClassNames={{
                    viewport: 'overscroll-contain',
                    content: cn(
                      'flex flex-wrap content-start items-start justify-center gap-2',
                      isAgentStrategyIntegrationPage && 'pt-2',
                    ),
                    scrollbar: 'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1',
                  }}
                >
                  <div className="w-full">
                    <List pluginList={filteredList || []} />
                  </div>
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
                </ScrollArea>
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
      <PluginDetailPanel
        detail={currentPluginDetail}
        onUpdate={() => invalidateInstalledPluginList()}
        onHide={handleHide}
      />
    </>
  )
}

export default PluginsPanel
