'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import TooltipPlus from '@/app/components/base/tooltip-plus'
type Props = {
  title: string
  tooltip?: string
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
}) => {
  return (
    <div className={cn(inline && 'flex justify-between items-center')}>
      <div className='flex justify-between items-center'>
        <div className='flex items-center h-6'>
          <div className='text-xs font-medium text-gray-700 uppercase'>{title}</div>
          {tooltip && (
            <TooltipPlus popupContent={tooltip}>
              <HelpCircle className='w-3.5 h-3.5 ml-0.5 text-gray-400' />
            </TooltipPlus>
          )}

        </div>
        {operations && <div>{operations}</div>}
      </div>
      {children && <div className={cn(!inline && 'mt-1')}>{children}</div>}
    </div>
  )
}
export default React.memo(Filed)
