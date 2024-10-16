'use client'
import { useState } from 'react'
import type { PluginDetail } from '../types'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { toolNotion } from '@/app/components/plugins/plugin-detail-panel/mock'

import type { FilterState } from './filter-management'
import FilterManagement from './filter-management'
import List from './list'

const PluginsPanel = () => {
  const handleFilterChange = (filters: FilterState) => {
    //
  }

  const [currentPluginDetail, setCurrentPluginDetail] = useState<PluginDetail | undefined>(toolNotion as any)
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
      <PluginDetailPanel pluginDetail={currentPluginDetail} onHide={() => setCurrentPluginDetail(undefined)} />
    </>
  )
}

export default PluginsPanel
