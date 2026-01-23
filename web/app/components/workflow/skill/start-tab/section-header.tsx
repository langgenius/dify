'use client'

import type { FC } from 'react'
import { memo } from 'react'

type SectionHeaderProps = {
  title: string
  description: string
}

const SectionHeader: FC<SectionHeaderProps> = ({
  title,
  description,
}) => {
  return (
    <header className="mb-3 flex flex-col gap-0.5">
      <h2 className="title-xl-semi-bold text-text-primary">
        {title}
      </h2>
      <p className="system-xs-regular text-text-tertiary">
        {description}
      </p>
    </header>
  )
}

export default memo(SectionHeader)
