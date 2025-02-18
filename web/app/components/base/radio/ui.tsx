'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

type Props = {
  isChecked: boolean
}

const RadioUI: FC<Props> = ({
  isChecked,
}) => {
  return (
    <div className={cn(isChecked ? 'border-components-radio-border-checked border-[5px]' : 'border-components-radio-border border-[2px]', 'h-4 w-4  rounded-full')}>
    </div>
  )
}
export default React.memo(RadioUI)
