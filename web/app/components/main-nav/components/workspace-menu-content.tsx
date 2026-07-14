import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { getWorkspaceInitial } from '../utils'

export function WorkspaceIcon({ name, className }: { name?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-components-icon-bg-orange-dark-solid text-white shadow-xs',
        className,
      )}
    >
      <span className="system-md-semibold">{getWorkspaceInitial(name)}</span>
    </div>
  )
}

export function WorkspaceMenuItemContent({
  icon,
  label,
  trailing,
}: {
  icon: ReactNode
  label: ReactNode
  trailing?: ReactNode
}) {
  const labelTitle = typeof label === 'string' ? label : undefined
  const showTrailing = trailing !== undefined && trailing !== null

  return (
    <>
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary"
      >
        {icon}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-left system-md-regular text-text-secondary"
        title={labelTitle}
      >
        {label}
      </span>
      {showTrailing && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{trailing}</span>
      )}
    </>
  )
}
