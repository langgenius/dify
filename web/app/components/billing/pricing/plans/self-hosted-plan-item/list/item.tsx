import React from 'react'
import { RiCheckLine } from '@remixicon/react'

type ItemProps = {
  label: string
}

const Item = ({
  label,
}: ItemProps) => {
  return (
    <div className='flex items-center gap-x-1'>
      <div className='py-px'>
        <RiCheckLine className='size-4 shrink-0 text-text-tertiary' />
      </div>
      <span className='system-sm-regular grow text-text-secondary'>{label}</span>
    </div>
  )
}

export default React.memo(Item)
