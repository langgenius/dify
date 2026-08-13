'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useCallback } from 'react'

type Props = Readonly<{
  isExpand: boolean
  onExpandChange: (isExpand: boolean) => void
}>

const ExpandBtn: FC<Props> = ({ isExpand, onExpandChange }) => {
  const handleToggle = useCallback(() => {
    onExpandChange(!isExpand)
  }, [isExpand, onExpandChange])

  return (
    <IconButton aria-label={isExpand ? 'Collapse' : 'Expand'} onClick={handleToggle}>
      <span
        aria-hidden="true"
        className={cn(
          'size-4',
          isExpand ? 'i-ri-collapse-diagonal-line' : 'i-ri-expand-diagonal-line',
        )}
      />
    </IconButton>
  )
}
export default React.memo(ExpandBtn)
