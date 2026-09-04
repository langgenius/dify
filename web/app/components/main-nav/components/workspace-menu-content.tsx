import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

export function WorkspaceMenuItemContent({
  icon,
  label,
  trailing,
  trailingClassName,
}: {
  icon: ReactNode
  label: ReactNode
  trailing?: ReactNode
  trailingClassName?: string
}) {
  const showTrailing = trailing !== undefined && trailing !== null

  return (
    <>
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left system-md-regular text-text-secondary">
        {label}
      </span>
      {showTrailing && (
        <span
          className={cn('flex h-4 w-4 shrink-0 items-center justify-center', trailingClassName)}
        >
          {trailing}
        </span>
      )}
    </>
  )
}
