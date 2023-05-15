'use client'
import React, { FC, useEffect } from 'react'
import cn from 'classnames'
import { useBoolean } from 'ahooks'
import { ChevronRightIcon } from '@heroicons/react/24/outline'


export interface IPanelProps {
  className?: string
  headerIcon: React.ReactNode
  title: React.ReactNode
  headerRight?: React.ReactNode
  bodyClassName?: string
  children: React.ReactNode
  keepUnFold?: boolean
  foldDisabled?: boolean
  onFoldChange?: (fold: boolean) => void
  controlUnFold?: number
  controlFold?: number
}

const Panel: FC<IPanelProps> = ({
  className,
  headerIcon,
  title,
  headerRight,
  bodyClassName,
  children,
  keepUnFold,
  foldDisabled = false,
  onFoldChange,
  controlUnFold,
  controlFold
}) => {
  const [fold, { setTrue: setFold, setFalse: setUnFold, toggle: toggleFold }] = useBoolean(keepUnFold ? false : true)
  useEffect(() => {
    onFoldChange?.(fold)
  }, [fold])

  useEffect(() => {
    if (controlUnFold) {
      setUnFold()
    }
  }, [controlUnFold])

  useEffect(() => {
    if (controlFold) {
      setFold()
    }
  }, [controlFold])

  // overflow-hidden
  return (
    <div className={cn(className, 'w-full rounded-xl border border-gray-100 overflow-hidden select-none')}>
      {/* Header */}
      <div
        onClick={() => (!foldDisabled && !keepUnFold) && toggleFold()}
        className={cn(!fold && 'border-b border-gray-100', 'flex justify-between items-center h-12 bg-gray-50 pl-4 pr-2')}>
        <div className='flex items-center gap-2'>
          {headerIcon}
          <div className='text-gray-900 text-sm'>{title}</div>
        </div>
        {(fold && headerRight) ? headerRight : ''}
        {!headerRight && !keepUnFold && (
          <ChevronRightIcon className={cn(!fold && 'rotate-90', 'mr-2 cursor-pointer')} width="16" height="16">
          </ChevronRightIcon>
        )}
      </div>

      {/* Main Content */}

      {!fold && !foldDisabled && (
        <div className={cn(bodyClassName)}>
          {children}
        </div>
      )}
    </div>
  )
}
export default React.memo(Panel)
