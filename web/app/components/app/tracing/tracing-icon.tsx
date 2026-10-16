'use client'
import { cn } from '@langgenius/dify-ui/cn'

type TracingIconProps = {
  className?: string
  size: 'lg' | 'md'
}

const sizeClassMap = {
  lg: 'w-9 h-9 p-2 rounded-[10px]',
  md: 'w-6 h-6 p-1 rounded-lg',
}

export function TracingIcon({ className, size }: TracingIconProps) {
  const sizeClass = sizeClassMap[size]
  return (
    <div className={cn(sizeClass, 'bg-primary-500 shadow-md', className)}>
      <span aria-hidden className="i-custom-public-tracing-tracing-icon size-full" />
    </div>
  )
}
