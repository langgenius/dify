'use client'
import type { FC } from 'react'
import * as React from 'react'

type Props = {
  label: string
  children: React.ReactNode
}

const Field: FC<Props> = ({
  label,
  children,
}) => {
  return (
    <div className="flex items-start space-x-2">
      <div className="system-xs-medium w-[128px] shrink-0 items-center truncate py-1 text-text-tertiary">
        {label}
      </div>
      <div className="w-[244px] shrink-0">
        {children}
      </div>
    </div>
  )
}

export default React.memo(Field)
