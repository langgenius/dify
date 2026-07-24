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
      <div className="system-sm-semibold py-1 text-text-secondary">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}
export default React.memo(Field)
