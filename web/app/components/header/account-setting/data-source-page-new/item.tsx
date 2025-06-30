import { memo } from 'react'
import Indicator from '@/app/components/header/indicator'
import Operator from './operator'

const Item = () => {
  return (
    <div className='flex h-10 items-center rounded-lg bg-components-panel-on-panel-item-bg pl-3 pr-1'>
      <div className='mr-2 h-5 w-5 shrink-0'></div>
      <div className='system-sm-medium grow text-text-secondary'>
        Evan’s Notion
      </div>
      <div className='flex shrink-0 items-center'>
        <div className='mr-1 flex h-3 w-3 items-center justify-center'>
          <Indicator color='green' />
        </div>
        <div className='system-xs-semibold-uppercase text-util-colors-green-green-600'>
          connected
        </div>
      </div>
      <div className='ml-3 mr-2 h-3 w-[1px] bg-divider-regular'></div>
      <Operator />
    </div>
  )
}

export default memo(Item)
