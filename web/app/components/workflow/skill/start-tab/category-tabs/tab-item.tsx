'use client'

import { memo } from 'react'
import { cn } from '@/utils/classnames'

type TabItemProps = {
  label: string
  isActive: boolean
  onClick: () => void
}

const TabItem = ({
  label,
  isActive,
  onClick,
}: TabItemProps) => {
  return (
    <button
      type="button"
      className={cn(
        'grid shrink-0 rounded-lg px-3 py-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-active',
        isActive
          ? 'bg-state-base-active'
          : 'hover:bg-state-base-hover',
      )}
      onClick={onClick}
    >
      <span className="system-sm-semibold col-start-1 row-start-1 opacity-0" aria-hidden="true">
        {label}
      </span>
      <span
        className={cn(
          'col-start-1 row-start-1',
          isActive
            ? 'system-sm-semibold text-text-primary'
            : 'system-sm-medium text-text-tertiary',
        )}
      >
        {label}
      </span>
    </button>
  )
}

export default memo(TabItem)
