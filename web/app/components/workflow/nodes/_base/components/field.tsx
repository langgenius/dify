'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useBoolean } from 'ahooks'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
type Props = {
  title: string
  tooltip?: string
  supportFold?: boolean
  children?: JSX.Element | string | null
  operations?: JSX.Element
  inline?: boolean
}

const Filed: FC<Props> = ({
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
    <div className={cn(inline && 'flex justify-between items-center', supportFold && 'cursor-pointer')}>
      <div
        onClick={() => supportFold && toggleFold()}
        className='flex justify-between items-center'>
        <div className='flex items-center h-6'>
          <div className='text-[13px] font-medium text-gray-700 uppercase'>{title}</div>
          {tooltip && (
            <TooltipPlus popupContent={
              <div className='w-[120px]'>
                {tooltip}
              </div>}>
              <HelpCircle className='w-3.5 h-3.5 ml-0.5 text-gray-400' />
            </TooltipPlus>
          )}

        </div>
        <div className='flex'>
          {operations && <div>{operations}</div>}
          {supportFold && (
            <ChevronRight className='w-3.5 h-3.5 text-gray-500 cursor-pointer transform transition-transform' style={{ transform: fold ? 'rotate(0deg)' : 'rotate(90deg)' }} />
          )}
        </div>
      </div>
      {children && (!supportFold || (supportFold && !fold)) && <div className={cn(!inline && 'mt-1')}>{children}</div>}
    </div>
  )
}
export default React.memo(Filed)
