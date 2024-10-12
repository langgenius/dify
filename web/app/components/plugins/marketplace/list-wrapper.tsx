'use client'

import type { ReactNode } from 'react'
import cn from '@/utils/classnames'

type ListWrapperProps = {
  children: ReactNode
}
const ListWrapper = ({
  children,
}: ListWrapperProps) => {
  return (
    <div
      className={cn(
        'px-12 py-2 bg-background-default-subtle',
      )}
    >
      {children}
    </div>
  )
}

export default ListWrapper
