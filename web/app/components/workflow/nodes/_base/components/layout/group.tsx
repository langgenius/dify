import type { ReactNode } from 'react'
import cn from '@/utils/classnames'

export type GroupProps = {
  className?: string
  children?: ReactNode
  withBorderBottom?: boolean
}
export const Group = ({
  className,
  children,
  withBorderBottom,
}: GroupProps) => {
  return (
    <div
      className={cn(
        'px-4 py-2',
        withBorderBottom && 'border-b border-divider-subtle',
        className,
      )}>
      {children}
    </div>
  )
}
