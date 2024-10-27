'use client'
import type { FC } from 'react'
import React from 'react'
import { format } from '@/service/base'

export type ITextGenerationProps = {
  value: string
  className?: string
}

const TextGeneration: FC<ITextGenerationProps> = ({
  value,
  className,
}) => {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{
        __html: format(value),
      }}
    >
    </div>
  )
}

export default React.memo(TextGeneration)
