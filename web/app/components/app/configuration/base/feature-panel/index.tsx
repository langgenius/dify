'use client'
import type { FC, ReactNode } from 'react'
import React from 'react'
import cn from 'classnames'
import ParamsConfig from '@/app/components/app/configuration/config-voice/param-config'

export type IFeaturePanelProps = {
  className?: string
  headerIcon?: ReactNode
  title: ReactNode
  headerRight?: ReactNode
  hasHeaderBottomBorder?: boolean
  isFocus?: boolean
  noBodySpacing?: boolean
  children?: ReactNode
  isShowTextToSpeech?: boolean
}

const FeaturePanel: FC<IFeaturePanelProps> = ({
  className,
  headerIcon,
  title,
  headerRight,
  hasHeaderBottomBorder,
  isFocus,
  noBodySpacing,
  children,
  isShowTextToSpeech,
}) => {
  return (
    <div
      className={cn(className, isFocus && 'border border-[#2D0DEE]', 'rounded-xl bg-gray-50 pt-2 pb-3', noBodySpacing && '!pb-0')}
      style={isFocus
        ? {
          boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
        }
        : {}}
    >
      {/* Header */}
      <div className={cn('pb-2 px-3', hasHeaderBottomBorder && 'border-b border-gray-100')}>
        <div className='flex justify-between items-center h-8'>
          <div className='flex items-center space-x-1 shrink-0'>
            {headerIcon && <div className='flex items-center justify-center w-6 h-6'>{headerIcon}</div>}
            <div className='text-sm font-semibold text-gray-800'>{title}</div>
          </div>
          <div className='flex gap-2 items-center'>
            {headerRight && <div>{headerRight}</div>}
            {isShowTextToSpeech && <div className='flex items-center'>
              <ParamsConfig/>
            </div>}
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
