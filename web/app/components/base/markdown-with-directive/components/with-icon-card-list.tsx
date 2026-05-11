import type { ReactNode } from 'react'
import type { WithIconCardListProps } from './markdown-with-directive-schema'
import { cn } from '@langgenius/dify-ui/cn'

type WithIconListProps = WithIconCardListProps & {
  children?: ReactNode
}

function WithIconCardList({ children, className }: WithIconListProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {children}
    </div>
  )
}

export default WithIconCardList
