'use client'

import type { ReactNode } from 'react'

type SectionHeaderProps = {
  title: string
  description: string
  action?: ReactNode
}

const SectionHeader = ({
  title,
  description,
  action,
}: SectionHeaderProps) => {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-text-primary system-md-semibold">{title}</div>
        <div className="mt-1 text-text-tertiary system-sm-regular">{description}</div>
      </div>
      {action}
    </div>
  )
}

export default SectionHeader
