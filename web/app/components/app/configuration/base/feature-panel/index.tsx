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
    <div className={cn('rounded-xl border-t-[0.5px] border-l-[0.5px] bg-background-section-burn pb-3', noBodySpacing && '!pb-0', className)}>
      {/* Header */}
      <div className={cn('px-3 pt-2', hasHeaderBottomBorder && 'border-b border-divider-subtle')}>
        <div className='flex justify-between items-center h-8'>
          <div className='flex items-center space-x-1 shrink-0'>
            {headerIcon && <div className='flex items-center justify-center w-6 h-6'>{headerIcon}</div>}
            <div className='text-text-secondary system-sm-semibold'>{title}</div>
          </div>
          <div className='flex gap-2 items-center'>
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
