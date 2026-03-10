'use client'
import type { FC } from 'react'
import * as React from 'react'

type Props = {
  className?: string
  label: string
  children: React.ReactNode
}

const Field: FC<Props> = ({
  className,
  label,
  children,
}) => {
  return (
    <div className={className}>
      <div className="py-1 text-text-secondary system-sm-semibold">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}
export default React.memo(Field)
