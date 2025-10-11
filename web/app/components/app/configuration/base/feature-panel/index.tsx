'use client'
import type { FC, ReactNode } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

export type IFeaturePanelProps = {
  className?: string
  headerIcon?: ReactNode
  title: ReactNode
  headerRight?: ReactNode
  hasHeaderBottomBorder?: boolean
  noBodySpacing?: boolean
  children?: ReactNode
}

const FeaturePanel: FC<IFeaturePanelProps> = ({
  className,
  headerIcon,
  title,
  headerRight,
  hasHeaderBottomBorder,
  noBodySpacing,
  children,
}) => {
  return (
    <div className={cn('rounded-xl border-l-[0.5px] border-t-[0.5px] border-effects-highlight bg-background-section-burn pb-3', noBodySpacing && 'pb-0', className)}>
      {/* Header */}
      <div className={cn('px-3 pt-2', hasHeaderBottomBorder && 'border-b border-divider-subtle')}>
        <div className='flex h-8 items-center justify-between'>
          <div className='flex shrink-0 items-center space-x-1'>
            {headerIcon && <div className='flex h-6 w-6 items-center justify-center'>{headerIcon}</div>}
            <div className='system-sm-semibold text-text-secondary'>{title}</div>
          </div>
          <div className='flex items-center gap-2'>
            {headerRight && <div>{headerRight}</div>}
          </div>
        </div>
      </div>
      {/* Body */}
      {children && (
        <div className={cn(!noBodySpacing && 'mt-1 px-3')}>
          {children}
        </div>
      )}
    </div>
  )
}
export default React.memo(FeaturePanel)
