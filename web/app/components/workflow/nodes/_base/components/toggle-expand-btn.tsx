'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import {
  RiCollapseDiagonalLine,
  RiExpandDiagonalLine,
} from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'

type Props = {
  isExpand: boolean
  onExpandChange: (isExpand: boolean) => void
}

const ExpandBtn: FC<Props> = ({
  isExpand,
  onExpandChange,
}) => {
  const handleToggle = useCallback(() => {
    onExpandChange(!isExpand)
  }, [isExpand])

  const Icon = isExpand ? RiCollapseDiagonalLine : RiExpandDiagonalLine
  return (
    <ActionButton onClick={handleToggle}>
      <Icon className='w-4 h-4' />
    </ActionButton>
  )
}
export default React.memo(ExpandBtn)
