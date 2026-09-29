'use client'
import type { FC } from 'react'
import * as React from 'react'

type Props = Readonly<{
  label: string
  children: React.ReactNode
}>

const Field: FC<Props> = ({ label, children }) => {
  return (
    <div className="flex items-start space-x-2">
      <div className="w-32 shrink-0 items-center truncate py-1 system-xs-medium text-text-tertiary">
        {label}
      </div>
      <div className="w-61 shrink-0">{children}</div>
    </div>
  )
}

export default React.memo(Field)
