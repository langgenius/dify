'use client'
import { useMemo, useState } from 'react'
import type { EndpointListItem, InstalledPlugin } from '../types'
import type { FilterState } from './filter-management'
import FilterManagement from './filter-management'
import List from './list'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { toolNotionEndpoints } from '@/app/components/plugins/plugin-detail-panel/mock'
import { usePluginPageContext } from './context'
import { useDebounceFn } from 'ahooks'

const PluginsPanel = () => {
  const [filters, setFilters] = usePluginPageContext(v => [v.filters, v.setFilters])
  const pluginList = usePluginPageContext(v => v.installedPluginList) as InstalledPlugin[]
  const currentPluginDetail = usePluginPageContext(v => v.currentPluginDetail)
  const setCurrentPluginDetail = usePluginPageContext(v => v.setCurrentPluginDetail)

  const { run: handleFilterChange } = useDebounceFn((filters: FilterState) => {
    setFilters(filters)
  }, { wait: 500 })

  const filteredList = useMemo(() => {
    // todo: filter by tags
    const { categories, searchQuery } = filters
    const filteredList = pluginList.filter((plugin) => {
      return (
        (categories.length === 0 || categories.includes(plugin.declaration.category))
        && (searchQuery === '' || plugin.plugin_id.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    })
    return filteredList
  }, [pluginList, filters])

  const [currentPluginEndpoints, setCurrentEndpoints] = useState<EndpointListItem[]>(toolNotionEndpoints as any)
  return (
    <>
      <div className='flex flex-col pt-1 pb-3 px-12 justify-center items-start gap-3 self-stretch'>
        <div className='h-px self-stretch bg-divider-subtle'></div>
        <FilterManagement
          onFilterChange={handleFilterChange}
        />
      </div>
      <div className='flex px-12 items-start content-start gap-2 flex-grow self-stretch flex-wrap'>
        <div className='w-full'>
          <List pluginList={filteredList} />
        </div>
      </div>
      <PluginDetailPanel
        pluginDetail={currentPluginDetail}
        endpointList={currentPluginEndpoints}
        onHide={() => {
          setCurrentPluginDetail(undefined)
          setCurrentEndpoints([])
        }}
      />
    </>
  )
}

export default PluginsPanel
