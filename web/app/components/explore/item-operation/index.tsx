'use client'
import React, { FC } from 'react'
import cn from 'classnames'
import Popover from '@/app/components/base/popover'
import { TrashIcon } from '@heroicons/react/24/outline'

import s from './style.module.css'

export interface IItemOperationProps {
  className?: string
}

const ItemOperation: FC<IItemOperationProps> = ({
  className,
}) => {
  return (
    <Popover
      htmlContent={
        <div className='w-full py-1'>
          <div className={cn(s.actionItem, s.deleteActionItem, 'hover:bg-gray-50 group')} onClick={() => {}}>
            <TrashIcon className={'w-4 h-4 stroke-current text-gray-500 stroke-2 group-hover:text-red-500'} />
            <span className={cn(s.actionName, 'group-hover:text-red-500')}>{'Delete'}</span>
          </div>
        </div>
      }
      trigger='click'
      position='br'
      btnElement={<div className={cn(s.actionIcon, s.commonIcon)} />}
      btnClassName={(open) => cn(className, 'h-6 w-6 rounded-md border-none p-1 bg-transparent hover:bg-gray-100', open && '!bg-gray-100 !shadow-none')}
      className={`!w-[200px] h-fit !z-20`}
    />
  )
}
export default React.memo(ItemOperation)
