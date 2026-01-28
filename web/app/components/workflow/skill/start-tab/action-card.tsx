'use client'

import type { ReactNode } from 'react'
import { memo } from 'react'
import { cn } from '@/utils/classnames'

type ActionCardProps = {
  icon: ReactNode
  title: string
  description: string
  onClick?: () => void
}

const ActionCard = ({
  icon,
  title,
  description,
  onClick,
}: ActionCardProps) => {
  return (
    <button
      type="button"
      className={cn(
        'flex items-start gap-3 rounded-xl border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-4',
        'hover:bg-components-panel-on-panel-item-bg-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-active',
        'text-left transition-colors',
      )}
      onClick={onClick}
    >
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-divider-regular bg-background-section"
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
        <span className="system-md-semibold truncate text-text-secondary">
          {title}
        </span>
        <span className="system-xs-regular text-text-tertiary">
          {description}
        </span>
      </div>
    </button>
  )
}

export default memo(ActionCard)
