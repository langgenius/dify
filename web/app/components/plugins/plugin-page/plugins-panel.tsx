'use client'
import { useState } from 'react'
import type { EndpointListItem, PluginDetail } from '../types'
import type { FilterState } from './filter-management'
import FilterManagement from './filter-management'
import List from './list'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { toolNotion, toolNotionEndpoints } from '@/app/components/plugins/plugin-detail-panel/mock'

const PluginsPanel = () => {
  const handleFilterChange = (filters: FilterState) => {
    //
  }

  const [currentPluginDetail, setCurrentPluginDetail] = useState<PluginDetail | undefined>(toolNotion as any)
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
          <List />
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
