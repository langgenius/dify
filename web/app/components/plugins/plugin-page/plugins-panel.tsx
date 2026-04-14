'use client'
import type { PluginDetail } from '../types'
import type { FilterState } from './filter-management'
import { useDebounceFn } from 'ahooks'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { Button } from '@/app/components/base/ui/button'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n-config'
import { useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { usePluginsWithLatestVersion } from '../hooks'
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

const PluginsPanel = () => {
  const { t } = useTranslation()
  const locale = useGetLanguage()
  const filters = usePluginPageContext(v => v.filters) as FilterState
  const setFilters = usePluginPageContext(v => v.setFilters)
  const { data: pluginList, isLoading: isPluginListLoading, isFetching, isLastPage, loadNextPage } = useInstalledPluginList()
  const pluginListWithLatestVersion = usePluginsWithLatestVersion(pluginList?.plugins)
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginID = usePluginPageContext(v => v.currentPluginID)
  const setCurrentPluginID = usePluginPageContext(v => v.setCurrentPluginID)

  const { run: handleFilterChange } = useDebounceFn((filters: FilterState) => {
    setFilters(filters)
  }, { wait: 500 })

  const filteredList = useMemo(() => {
    const { categories, searchQuery, tags } = filters
    const filteredList = pluginListWithLatestVersion.filter((plugin) => {
      return (
        (categories.length === 0 || categories.includes(plugin.declaration.category))
        && (tags.length === 0 || tags.some(tag => plugin.declaration.tags.includes(tag)))
        && matchesSearchQuery(plugin, searchQuery, locale)
      )
    })
    return filteredList
  }, [pluginListWithLatestVersion, filters, locale])

  const currentPluginDetail = useMemo(() => {
    const detail = pluginListWithLatestVersion.find(plugin => plugin.plugin_id === currentPluginID)
    return detail
  }, [currentPluginID, pluginListWithLatestVersion])

  const handleHide = () => setCurrentPluginID(undefined)

  return (
    <>
      <div className="flex flex-col items-start justify-center gap-3 self-stretch px-12 pt-1 pb-3">
        <div className="h-px self-stretch bg-divider-subtle"></div>
        <FilterManagement
          onFilterChange={handleFilterChange}
        />
      </div>
      {isPluginListLoading && <Loading type="app" />}
      {!isPluginListLoading && (
        <>
          {(filteredList?.length ?? 0) > 0
            ? (
                <div className="flex grow flex-wrap content-start items-start justify-center gap-2 self-stretch overflow-y-auto px-12">
                  <div className="w-full">
                    <List pluginList={filteredList || []} />
                  </div>
                  {!isLastPage && (
                    <div className="flex justify-center py-4">
                      {isFetching
                        ? <Loading className="size-8" />
                        : (
                            <Button onClick={loadNextPage}>
                              {t('common.loadMore', { ns: 'workflow' })}
                            </Button>
                          )}
                    </div>
                  )}
                </div>
              )
            : (
                <Empty />
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
