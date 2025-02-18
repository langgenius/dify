'use client'
import type { FC } from 'react'
import React from 'react'
import {
  RiAddLine,
} from '@remixicon/react'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'

interface Props {
  className?: string
  text: string
  onClick: () => void
}

const AddButton: FC<Props> = ({
  className,
  text,
  onClick,
}) => {
  return (
    <Button
      className={cn('w-full', className)}
      variant='tertiary'
      size='medium'
      onClick={onClick}
    >
      <RiAddLine className='mr-1 h-3.5 w-3.5' />
      <div>{text}</div>
    </Button>
  )
}
export default React.memo(AddButton)
