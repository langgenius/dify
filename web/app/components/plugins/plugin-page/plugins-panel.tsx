'use client'

import type { FilterState } from './filter-management'
import FilterManagement from './filter-management'
import List from './list'

const PluginsPanel = () => {
  const handleFilterChange = (filters: FilterState) => {
    //
  }

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
    </>
  )
}

export default PluginsPanel
