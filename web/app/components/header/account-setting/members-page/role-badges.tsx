'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'

type RoleBadgeProps = {
  label: string
  className?: string
}

const RoleBadge = ({ label, className }: RoleBadgeProps) => {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center rounded-md bg-background-body px-1.5 system-xs-medium text-text-secondary shadow-xs',
        className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  )
}

export type RoleBadgesProps = {
  roles: string[]
  max?: number
  className?: string
}

const RoleBadges = ({ roles, max = 2, className }: RoleBadgesProps) => {
  if (!roles.length)
    return null

  const visible = roles.slice(0, max)
  const overflow = roles.slice(max)

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {visible.map(role => (
        <RoleBadge key={role} label={role} />
      ))}
      {overflow.length > 0 && (
        <span
          className="inline-flex h-5 cursor-default items-center rounded-md bg-background-body px-1.5 system-xs-medium text-text-tertiary shadow-xs"
        >
          {`+${overflow.length}`}
        </span>
      )}
    </div>
  )
}

export default memo(RoleBadges)
