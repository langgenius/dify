'use client'
import { useMemo } from 'react'
import type { FilterState } from './filter-management'
import FilterManagement from './filter-management'
import List from './list'
import { useInstalledLatestVersion, useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { usePluginPageContext } from './context'
import { useDebounceFn } from 'ahooks'
import Empty from './empty'
import Loading from '../../base/loading'
import { PluginSource } from '../types'

const PluginsPanel = () => {
  const filters = usePluginPageContext(v => v.filters) as FilterState
  const setFilters = usePluginPageContext(v => v.setFilters)
  const { data: pluginList, isLoading: isPluginListLoading } = useInstalledPluginList()
  const { data: installedLatestVersion } = useInstalledLatestVersion(
    pluginList?.plugins
      .filter(plugin => plugin.source === PluginSource.marketplace)
      .map(plugin => plugin.plugin_id) ?? [],
  )
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginID = usePluginPageContext(v => v.currentPluginID)
  const setCurrentPluginID = usePluginPageContext(v => v.setCurrentPluginID)

  const { run: handleFilterChange } = useDebounceFn((filters: FilterState) => {
    setFilters(filters)
  }, { wait: 500 })

  const pluginListWithLatestVersion = useMemo(() => {
    return pluginList?.plugins.map(plugin => ({
      ...plugin,
      latest_version: installedLatestVersion?.versions[plugin.plugin_id]?.version ?? '',
      latest_unique_identifier: installedLatestVersion?.versions[plugin.plugin_id]?.unique_identifier ?? '',
    })) || []
  }, [pluginList, installedLatestVersion])

  const filteredList = useMemo(() => {
    const { categories, searchQuery, tags } = filters
    const filteredList = pluginListWithLatestVersion.filter((plugin) => {
      return (
        (categories.length === 0 || categories.includes(plugin.declaration.category))
        && (tags.length === 0 || tags.some(tag => plugin.declaration.tags.includes(tag)))
        && (searchQuery === '' || plugin.plugin_id.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    })
    return filteredList
  }, [pluginListWithLatestVersion, filters])

  const currentPluginDetail = useMemo(() => {
    const detail = pluginListWithLatestVersion.find(plugin => plugin.plugin_id === currentPluginID)
    return detail
  }, [currentPluginID, pluginListWithLatestVersion])

  const handleHide = () => setCurrentPluginID(undefined)

  return (
    <>
      <div className='flex flex-col items-start justify-center gap-3 self-stretch px-12 pb-3 pt-1'>
        <div className='h-px self-stretch bg-divider-subtle'></div>
        <FilterManagement
          onFilterChange={handleFilterChange}
        />
      </div>
      {isPluginListLoading ? <Loading type='app' /> : (filteredList?.length ?? 0) > 0 ? (
        <div className='flex grow flex-wrap content-start items-start gap-2 self-stretch px-12'>
          <div className='w-full'>
            <List pluginList={filteredList || []} />
          </div>
        </div>
      ) : (
        <Empty />
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
