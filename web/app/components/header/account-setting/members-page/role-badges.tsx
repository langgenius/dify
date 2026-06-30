'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'

type RoleBadgeProps = {
  label: string
  className?: string
}

const RoleBadge = memo(({ label, className }: RoleBadgeProps) => {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full shrink items-center overflow-hidden rounded-md bg-background-body px-1.5 system-xs-medium text-text-secondary shadow-xs',
        className,
      )}
      title={label}
    >
      <span className="truncate">{label}</span>
    </span>
  )
})

type RoleBadgesProps = {
  roleNames: string[]
  max?: number
  className?: string
}

const RoleBadges = ({ roleNames, max = 2, className }: RoleBadgesProps) => {
  const visible = roleNames.slice(0, max)
  const overflow = roleNames.slice(max)

  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      {visible.map(role => (
        <RoleBadge key={role} label={role} />
      ))}
      {overflow.length > 0 && (
        <span
          className="inline-flex h-5 shrink-0 cursor-default items-center rounded-md bg-background-body px-1.5 system-xs-medium text-text-tertiary shadow-xs"
        >
          {`+${overflow.length}`}
        </span>
      )}
    </span>
  )
}

export default memo(RoleBadges)
