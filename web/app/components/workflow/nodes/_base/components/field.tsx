'use client'
import type { FC } from 'react'
import React from 'react'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import type { DefaultTFuncReturn } from 'i18next'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  className?: string
  title: JSX.Element | string | DefaultTFuncReturn
  tooltip?: string
  supportFold?: boolean
  children?: JSX.Element | string | null
  operations?: JSX.Element
  inline?: boolean
}

const Filed: FC<Props> = ({
  className,
  title,
  tooltip,
  children,
  operations,
  inline,
  supportFold,
}) => {
  const [fold, {
    toggle: toggleFold,
  }] = useBoolean(true)
  return (
    <div className={cn(className, inline && 'flex justify-between items-center w-full')}>
      <div
        onClick={() => supportFold && toggleFold()}
        className={cn('flex justify-between items-center', supportFold && 'cursor-pointer')}>
        <div className='flex items-center h-6'>
          <div className='system-sm-semibold-uppercase text-text-secondary'>{title}</div>
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
            <RiArrowDownSLine className='w-4 h-4 text-text-tertiary cursor-pointer transform transition-transform' style={{ transform: fold ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
          )}
        </div>
      </div>
      {children && (!supportFold || (supportFold && !fold)) && <div className={cn(!inline && 'mt-1')}>{children}</div>}
    </div>
  )
}
export default React.memo(Filed)
