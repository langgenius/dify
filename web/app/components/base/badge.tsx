import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'

type BadgeProps = {
  className?: string
  text?: ReactNode
  children?: ReactNode
  uppercase?: boolean
  hasRedCornerMark?: boolean
}

const Badge = ({
  className,
  text,
  children,
  uppercase = true,
  hasRedCornerMark,
}: BadgeProps) => {
  return (
    <div
      className={cn(
        'relative inline-flex h-5 items-center rounded-[5px] border border-divider-deep px-[5px] leading-3 whitespace-nowrap text-text-tertiary',
        uppercase ? 'system-2xs-medium-uppercase' : 'system-xs-medium',
        className,
      )}
    >
      {hasRedCornerMark && (
        <div className="absolute top-[-2px] right-[-2px] h-1.5 w-1.5 rounded-xs border border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-sm">
        </div>
      )}
      {children || text}
    </div>
  )
}

export default memo(Badge)
