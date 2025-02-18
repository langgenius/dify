import type { ReactNode } from 'react'
import { memo } from 'react'
import cn from '@/utils/classnames'

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
        'border-divider-deep text-text-tertiary relative inline-flex h-5 items-center rounded-[5px] border px-[5px] leading-3',
        uppercase ? 'system-2xs-medium-uppercase' : 'system-xs-medium',
        className,
      )}
    >
      {hasRedCornerMark && (
        <div className='border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg absolute right-[-2px] top-[-2px] h-1.5 w-1.5 rounded-[2px] border shadow-sm'>
        </div>
      )}
      {children || text}
    </div>
  )
}

export default memo(Badge)
