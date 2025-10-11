'use client'
import type { FC, ReactNode } from 'react'
import React from 'react'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  className?: string
  title: ReactNode
  tooltip?: ReactNode
  isSubTitle?: boolean
  supportFold?: boolean
  children?: React.JSX.Element | string | null
  operations?: React.JSX.Element
  inline?: boolean
  required?: boolean
}

const Field: FC<Props> = ({
  className,
  title,
  isSubTitle,
  tooltip,
  children,
  operations,
  inline,
  supportFold,
  required,
}) => {
  const [fold, {
    toggle: toggleFold,
  }] = useBoolean(true)
  return (
    <div className={cn(className, inline && 'flex w-full items-center justify-between')}>
      <div
        onClick={() => supportFold && toggleFold()}
        className={cn('flex items-center justify-between', supportFold && 'cursor-pointer')}>
        <div className='flex h-6 items-center'>
          <div className={cn(isSubTitle ? 'system-xs-medium-uppercase text-text-tertiary' : 'system-sm-semibold-uppercase text-text-secondary')}>
            {title} {required && <span className='text-text-destructive'>*</span>}
          </div>
          {tooltip && (
            <Tooltip
              popupContent={tooltip}
              popupClassName='ml-1'
              triggerClassName='w-4 h-4 ml-1'
            />
          )}
        </div>
        <div className='flex'>
          {operations && <div>{operations}</div>}
          {supportFold && (
            <RiArrowDownSLine className='h-4 w-4 cursor-pointer text-text-tertiary transition-transform' style={{ transform: fold ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
          )}
        </div>
      </div>
      {children && (!supportFold || (supportFold && !fold)) && <div className={cn(!inline && 'mt-1')}>{children}</div>}
    </div>
  )
}
export default React.memo(Field)
