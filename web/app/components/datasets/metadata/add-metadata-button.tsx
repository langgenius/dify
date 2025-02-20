'use client'
import type { FC } from 'react'
import React from 'react'
import Button from '../../base/button'
import { RiAddLine } from '@remixicon/react'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  onClick?: () => void
}

const AddedMetadataButton: FC<Props> = ({
  className,
  onClick,
}) => {
  return (
    <Button
      className={cn('w-full flex items-center', className)}
      size='small'
      variant='tertiary'
      onClick={onClick}
    >
      <RiAddLine className='mr-1 size-3.5' />
      <div>Add metadata</div>
    </Button>
  )
}
export default React.memo(AddedMetadataButton)
