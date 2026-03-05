import type { ReactNode } from 'react'
import type { WithIconCardListProps } from './markdown-with-directive-schema'
import { cn } from '@/utils/classnames'

type WithIconListProps = WithIconCardListProps & {
  children?: ReactNode
}

function WithIconList({ children, className }: WithIconListProps) {
  return (
    <div className={cn('space-y-2 p-4', className)}>
      {children}
    </div>
  )
}

export default WithIconList
