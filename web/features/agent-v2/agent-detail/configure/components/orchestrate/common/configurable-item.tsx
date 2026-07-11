'use client'

import type { ReactNode } from 'react'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

export function ConfigureSectionConfigurableItem({
  badge,
  editAriaLabel,
  icon,
  label,
  removeAriaLabel,
  onEdit,
  onRemove,
}: {
  badge?: ReactNode
  editAriaLabel: string
  icon: ReactNode
  label: ReactNode
  removeAriaLabel: string
  onEdit: () => void
  onRemove: () => void
}) {
  const readOnly = useAgentOrchestrateReadOnly()
  const hasBadge = badge !== undefined && badge !== null

  return (
    <div className="group relative flex min-h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-1.5 pr-1.5 pl-2 shadow-xs shadow-shadow-shadow-3 focus-within:border-components-panel-border focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pr-1">
        {icon}
        <span className="min-w-0 truncate system-sm-medium text-text-primary">
          {label}
        </span>
      </div>
      {!readOnly && (
        <div className="pointer-events-none absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 bg-components-panel-on-panel-item-bg-hover opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            type="button"
            aria-label={editAriaLabel}
            onClick={onEdit}
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:bg-state-base-hover focus-visible:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-equalizer-2-line size-4" />
          </button>
          <button
            type="button"
            aria-label={removeAriaLabel}
            onClick={onRemove}
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:bg-state-destructive-hover focus-visible:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
          </button>
        </div>
      )}
      {hasBadge && (
        <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary group-focus-within:opacity-0 group-hover:opacity-0">
          {badge}
        </span>
      )}
    </div>
  )
}
