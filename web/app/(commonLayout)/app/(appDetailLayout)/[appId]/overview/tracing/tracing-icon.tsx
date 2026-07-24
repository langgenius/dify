'use client'
import type { FC } from 'react'
import * as React from 'react'
import { TracingIcon as Icon } from '@/app/components/base/icons/src/public/tracing'
import { cn } from '@/utils/classnames'

type Props = {
  className?: string
  size: 'lg' | 'md'
}

const sizeClassMap = {
  lg: 'w-9 h-9 p-2 rounded-[10px]',
  md: 'w-6 h-6 p-1 rounded-lg',
}

const TracingIcon: FC<Props> = ({
  className,
  size,
}) => {
  const sizeClass = sizeClassMap[size]
  return (
    <div className={cn(className, sizeClass, 'bg-primary-500 shadow-md')}>
      <Icon className="h-full w-full" />
    </div>
  )
}
export default React.memo(TracingIcon)
