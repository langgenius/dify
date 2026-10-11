'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type Props = Readonly<{
  className?: string
  size: 'lg' | 'md'
}>

const sizeClassMap = {
  lg: 'w-9 h-9 p-2 rounded-[10px]',
  md: 'w-6 h-6 p-1 rounded-lg',
}

const TracingIcon: FC<Props> = ({ className, size }) => {
  const sizeClass = sizeClassMap[size]
  return (
    <div className={cn(className, sizeClass, 'bg-primary-500 shadow-md')}>
      <span aria-hidden className="i-custom-public-tracing-tracing-icon size-full" />
    </div>
  )
}
export default React.memo(TracingIcon)
