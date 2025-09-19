import React from 'react'
import type { RemixiconComponentType } from '@remixicon/react'

type OperationItemProps = {
  Icon: RemixiconComponentType
  name: string
  handleClick?: () => void
}

const OperationItem = ({
  Icon,
  name,
  handleClick,
}: OperationItemProps) => {
  return (
    <div
      className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        handleClick?.()
      }}
    >
      <Icon className='size-4 text-text-tertiary' />
      <span className='system-md-regular px-1 text-text-secondary'>
        {name}
      </span>
    </div>
  )
}

export default React.memo(OperationItem)
