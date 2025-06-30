import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import {
  RiDeleteBinLine,
  RiLoopLeftLine,
  RiStickyNoteAddLine,
} from '@remixicon/react'
import Dropdown from '@/app/components/base/dropdown'
import type { Item } from '@/app/components/base/dropdown'

const Operator = () => {
  const items = useMemo(() => {
    return [
      {
        value: 'change',
        text: (
          <div className='flex'>
            <RiStickyNoteAddLine className='mr-2 h-4 w-4 text-text-tertiary' />
            <div>
              <div className='system-sm-semibold mb-1 text-text-secondary'>Change authorized pages</div>
              <div className='system-xs-regular text-text-tertiary'>18 Pages authorized</div>
            </div>
          </div>
        ),
      },
      {
        value: 'sync',
        text: (
          <div className='flex items-center'>
            <RiLoopLeftLine className='mr-2 h-4 w-4 text-text-tertiary' />
            <div className='system-sm-semibold text-text-secondary'>Sync</div>
          </div>
        ),
      },
    ]
  }, [])

  const secondItems = useMemo(() => {
    return [
      {
        value: 'delete',
        text: (
          <div className='flex items-center'>
            <RiDeleteBinLine className='mr-2 h-4 w-4 text-text-tertiary' />
            <div className='system-sm-semibold text-text-secondary'>Remove</div>
          </div>
        ),
      },
    ]
  }, [])

  const handleSelect = useCallback((item: Item) => {
    console.log('Selected item:', item)
  }, [])

  return (
   <Dropdown
    items={items}
    secondItems={secondItems}
    onSelect={handleSelect}
    popupClassName='z-[61]'
    triggerProps={{
      size: 'l',
    }}
    itemClassName='py-2 h-auto hover:bg-state-base-hover'
    secondItemClassName='py-2 h-auto hover:bg-state-base-hover'
   />
  )
}

export default memo(Operator)
