'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type Props = {
  depth?: number
  className?: string
}

const TreeIndentLine: FC<Props> = ({
  depth = 1,
  className,
}) => {
  const depthArray = Array.from({ length: depth }, (_, index) => index)
  return (
    <div className={cn('flex', className)}>
      {depthArray.map(d => (
        <div key={d} className={cn('mr-2.5 ml-2.5 w-px bg-divider-regular')}></div>
      ))}
    </div>
  )
}
export default React.memo(TreeIndentLine)
