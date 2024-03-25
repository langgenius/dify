'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'

type Props = {
  className?: string
}

const Split: FC<Props> = ({
  className,
}) => {
  return (
    <div className={cn(className, 'h-[0.5px] bg-black/5')}>
    </div>
  )
}
export default React.memo(Split)
