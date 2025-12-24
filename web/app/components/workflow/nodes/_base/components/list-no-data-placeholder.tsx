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
    <div className="system-xs-regular flex min-h-[42px] w-full items-center justify-center rounded-[10px] bg-background-section text-text-tertiary">
      {children}
    </div>
  )
}
export default React.memo(ListNoDataPlaceholder)
