'use client'
import { useMemo } from 'react'
import type { FilterState } from './filter-management'
import FilterManagement from './filter-management'
import List from './list'
import { useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { usePluginPageContext } from './context'
import { useDebounceFn } from 'ahooks'
import Empty from './empty'
import Loading from '../../base/loading'

const PluginsPanel = () => {
  const filters = usePluginPageContext(v => v.filters) as FilterState
  const setFilters = usePluginPageContext(v => v.setFilters)
  const { data: pluginList, isLoading: isPluginListLoading } = useInstalledPluginList()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginID = usePluginPageContext(v => v.currentPluginID)
  const setCurrentPluginID = usePluginPageContext(v => v.setCurrentPluginID)

  const { run: handleFilterChange } = useDebounceFn((filters: FilterState) => {
    setFilters(filters)
  }, { wait: 500 })

  const filteredList = useMemo(() => {
    const { categories, searchQuery, tags } = filters
    const filteredList = pluginList?.plugins.filter((plugin) => {
      return (
        (categories.length === 0 || categories.includes(plugin.declaration.category))
        && (tags.length === 0 || tags.some(tag => plugin.declaration.tags.includes(tag)))
        && (searchQuery === '' || plugin.plugin_id.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    })
    return filteredList
  }, [pluginList, filters])

  const currentPluginDetail = useMemo(() => {
    const detail = pluginList?.plugins.find(plugin => plugin.plugin_id === currentPluginID)
    return detail
  }, [currentPluginID, pluginList?.plugins])

  const handleHide = () => setCurrentPluginID(undefined)

  return (
    <>
      <div className='flex flex-col items-start justify-center gap-3 self-stretch px-12 pb-3 pt-1'>
        <div className='bg-divider-subtle h-px self-stretch'></div>
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
