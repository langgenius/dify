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
        'relative inline-flex items-center px-[5px] h-5 rounded-[5px] border border-divider-deep leading-3 text-text-tertiary',
        uppercase ? 'system-2xs-medium-uppercase' : 'system-xs-medium',
        className,
      )}
    >
      {hasRedCornerMark && (
        <div className='absolute top-[-2px] right-[-2px] w-1.5 h-1.5 border border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg rounded-[2px] shadow-sm'>
        </div>
      )}
      {children || text}
    </div>
  )
}

export default memo(Badge)
