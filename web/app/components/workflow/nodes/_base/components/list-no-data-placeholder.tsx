'use client'
import type { FC } from 'react'
import * as React from 'react'

type Props = {
  children: React.ReactNode
}

const ListNoDataPlaceholder: FC<Props> = ({
  children,
}) => {
  return (
    <div className="flex min-h-[42px] w-full items-center justify-center rounded-[10px] bg-background-section system-xs-regular text-text-tertiary">
      {children}
    </div>
  )
}
export default React.memo(ListNoDataPlaceholder)
