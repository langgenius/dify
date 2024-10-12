'use client'

import type { ReactNode } from 'react'
import cn from '@/utils/classnames'

type HeaderWrapperProps = {
  children: ReactNode
}
const HeaderWrapper = ({
  children,
}: HeaderWrapperProps) => {
  return (
    <div
      className={cn(
        'py-10',
      )}
    >
      {children}
    </div>
  )
}

export default HeaderWrapper
