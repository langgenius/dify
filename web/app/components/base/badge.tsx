import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'

type BadgeProps = {
  className?: string
  text?: ReactNode
  children?: ReactNode
  size?: 'm' | 'xs'
  variant?: 'default' | 'dimm'
  uppercase?: boolean
  hasRedCornerMark?: boolean
}

const Badge = ({
  className,
  text,
  children,
  size = 'm',
  variant = 'default',
  uppercase = true,
  hasRedCornerMark,
}: BadgeProps) => {
  return (
    <div
      className={cn(
        'relative inline-flex items-center rounded-[5px] border border-divider-deep leading-3 whitespace-nowrap text-text-tertiary',
        size === 'xs' ? 'min-w-4 justify-center px-1 py-0.5' : 'h-5 px-[5px]',
        variant === 'dimm' && 'bg-components-badge-bg-dimm',
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
