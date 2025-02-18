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
    <div className={cn('border-effects-highlight bg-background-section-burn rounded-xl border-l-[0.5px] border-t-[0.5px] pb-3', noBodySpacing && 'pb-0', className)}>
      {/* Header */}
      <div className={cn('px-3 pt-2', hasHeaderBottomBorder && 'border-divider-subtle border-b')}>
        <div className='flex h-8 items-center justify-between'>
          <div className='flex shrink-0 items-center space-x-1'>
            {headerIcon && <div className='flex h-6 w-6 items-center justify-center'>{headerIcon}</div>}
            <div className='text-text-secondary system-sm-semibold'>{title}</div>
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
