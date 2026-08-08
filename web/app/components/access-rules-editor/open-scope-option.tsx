'use client'

import type { ResourceOpenScope } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'

type OpenScopeOptionProps = {
  value: ResourceOpenScope
  selected: boolean
  disabled: boolean
  title: string
  description: string
  onChange?: (openScope: ResourceOpenScope) => void
}

function OpenScopeOption({
  value,
  selected,
  disabled,
  title,
  description,
  onChange,
}: OpenScopeOptionProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled || !onChange}
      className={cn(
        'flex min-h-19 flex-col items-start rounded-xl border bg-components-panel-bg px-7 py-3 text-left shadow-xs outline-hidden transition-colors',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        selected
          ? 'border-[1.5px] border-state-accent-solid'
          : 'border-components-panel-border hover:border-divider-deep',
        (disabled || !onChange) && 'cursor-not-allowed opacity-70',
      )}
      onClick={() => onChange?.(value)}
    >
      <div className="system-sm-semibold text-text-secondary">{title}</div>
      <p className="mt-0.5 system-xs-regular text-text-tertiary">{description}</p>
    </button>
  )
}

export default memo(OpenScopeOption)
