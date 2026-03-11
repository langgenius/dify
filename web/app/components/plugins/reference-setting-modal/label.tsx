'use client'
import type { FC } from 'react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type Props = {
  label: string
  description?: string
}

const Label: FC<Props> = ({
  label,
  description,
}) => {
  return (
    <div>
      <div className={cn('flex h-6 items-center', description && 'h-4')}>
        <span className="text-text-secondary system-sm-semibold">{label}</span>
      </div>
      {description && (
        <div className="mt-1 text-text-tertiary body-xs-regular">
          {description}
        </div>
      )}
    </div>
  )
}
export default React.memo(Label)
