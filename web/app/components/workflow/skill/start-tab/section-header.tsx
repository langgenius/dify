'use client'

import type { FC } from 'react'
import { memo } from 'react'

type SectionHeaderProps = {
  title: string
  description: string
  className?: string
}

const SectionHeader: FC<SectionHeaderProps> = ({
  title,
  description,
  className,
}) => {
  return (
    <header className={className}>
      <h2 className="title-xl-semi-bold text-text-primary">
        {title}
      </h2>
      <p className="system-xs-regular mt-0.5 text-text-tertiary">
        {description}
      </p>
    </header>
  )
}

export default memo(SectionHeader)
