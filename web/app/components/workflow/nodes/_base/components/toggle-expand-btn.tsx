'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import {
  RiCollapseDiagonalLine,
  RiExpandDiagonalLine,
} from '@remixicon/react'

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
    <Icon className='w-3.5 h-3.5 text-gray-500 cursor-pointer' onClick={handleToggle} />
  )
}
export default React.memo(ExpandBtn)
