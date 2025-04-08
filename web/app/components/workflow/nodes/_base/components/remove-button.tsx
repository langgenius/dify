'use client'
import type { FC } from 'react'
import React from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'

type Props = {
  className?: string
  onClick: (e: React.MouseEvent) => void
}

const Remove: FC<Props> = ({
  onClick,
}) => {
  return (
    <ActionButton size='l' onClick={onClick}>
      <RiDeleteBinLine className='h-4 w-4' />
    </ActionButton>
  )
}
export default React.memo(Remove)
