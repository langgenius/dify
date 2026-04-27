'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'

export type RoleTagProps = {
  label: string
  onRemove?: () => void
  className?: string
}

const RoleTag = ({ label, onRemove, className }: RoleTagProps) => {
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-0.5 rounded-md bg-components-badge-bg-gray-soft px-1.5 system-xs-medium text-text-secondary shadow-xs',
        className,
      )}
      data-testid="access-rule-role-tag"
    >
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="flex h-4 w-4 items-center justify-center rounded text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <span aria-hidden className="i-ri-close-line h-3 w-3" />
        </button>
      )}
    </span>
  )
}

export default memo(RoleTag)
