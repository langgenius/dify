import { useState } from 'react'
import cn from 'classnames'
import s from './base.module.css'
import WorkspaceSelector from './workspace-selector'
import SearchInput from './search-input'

const NotionPageSelector = () => {
  const [searchValue, setSearchValue] = useState('')
  const handleSearchValueChange = (value: string) => {
    setSearchValue(value)
  }
  return (
    <div className='bg-gray-25 border border-gray-200 rounded-xl'>
      <div className='flex items-center pl-[10px] pr-2 h-11 bg-white'>
        <WorkspaceSelector />
        <div className='mx-1 w-[1px] h-3 bg-gray-200' />
        <div className={cn(s['setting-icon'], 'w-6 h-6 cursor-pointer')} />
        <div className='grow' />
        <SearchInput
          value={searchValue}
          onChange={handleSearchValueChange}
        />
      </div>
      <div className='p-2'>
        <div className='flex items-center px-2 h-7 rounded-md'>
          <div className='mr-3 w-4 h-4'></div>
          <div className='mr-2 w-5 h-5'></div>
          <div className='text-sm font-medium text-gray-700'>sdfsfsfsd</div>
        </div>
      </div>
    </div>
  )
}

export default NotionPageSelector
