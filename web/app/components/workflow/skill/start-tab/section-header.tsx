'use client'

import { memo } from 'react'

type SectionHeaderProps = {
  title: string
  description: string
  className?: string
}

const SectionHeader = ({
  title,
  description,
  className,
}: SectionHeaderProps) => {
  return (
    <header className={className}>
      <h2 className="text-text-primary title-xl-semi-bold">
        {title}
      </h2>
      <p className="mt-0.5 text-text-tertiary system-xs-regular">
        {description}
      </p>
    </header>
  )
}

export default memo(SectionHeader)
