import * as React from 'react'
import { cn } from '@/utils/classnames'

type ItemProps = {
  isActive: boolean
  label: string
  onClick: () => void
}

const Item = ({
  isActive,
  label,
  onClick,
}: ItemProps) => {
  return (
    <div
      className={cn(
        'system-md-semibold relative flex h-full cursor-pointer items-center text-text-tertiary',
        isActive && 'text-text-primary',
      )}
      onClick={onClick}
    >
      {label}
      {
        isActive && (
          <div className="absolute bottom-0 h-0.5 w-full bg-util-colors-blue-brand-blue-brand-600" />
        )
      }
    </div>
  )
}

export default React.memo(Item)
