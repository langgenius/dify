'use client'
import type { FC } from 'react'
import {
  RiCollapseDiagonalLine,
  RiExpandDiagonalLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
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
      <Icon className="h-4 w-4" />
    </ActionButton>
  )
}
export default React.memo(ExpandBtn)
