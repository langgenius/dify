'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

type Props = {
  isChecked: boolean
  className?: string
}

const RadioUI: FC<Props> = ({
  isChecked,
  className,
}) => {
  return (
    <div
      className={cn(
        isChecked ? 'border-[5px] border-components-radio-border-checked' : 'border-[2px] border-components-radio-border',
        'h-4 w-4  rounded-full',
        className,
      )}
    >
    </div>
  )
}
export default React.memo(RadioUI)
