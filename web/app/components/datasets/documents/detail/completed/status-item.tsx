import React, { type FC } from 'react'
import { RiCheckLine } from '@remixicon/react'
import type { Item } from '@/app/components/base/select'

type IStatusItemProps = {
  item: Item
  selected: boolean
}

const StatusItem: FC<IStatusItemProps> = ({
  item,
  selected,
}) => {
  return (
    <div className='flex items-center justify-between py-1.5 px-2'>
      <span className='system-md-regular'>{item.name}</span>
      {selected && <RiCheckLine className='w-4 h-4 text-text-accent' />}
    </div>
  )
}

export default React.memo(StatusItem)
