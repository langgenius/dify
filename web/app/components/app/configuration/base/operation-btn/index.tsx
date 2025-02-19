'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiEditLine,
} from '@remixicon/react'
import cn from '@/utils/classnames'

export type IOperationBtnProps = {
  className?: string
  type: 'add' | 'edit'
  actionName?: string
  onClick?: () => void
}

const iconMap = {
  add: <RiAddLine className='w-3.5 h-3.5' />,
  edit: <RiEditLine className='w-3.5 h-3.5' />,
}

const OperationBtn: FC<IOperationBtnProps> = ({
  className,
  type,
  actionName,
  onClick = () => { },
}) => {
  const { t } = useTranslation()
  return (
    <div
      className={cn('flex items-center rounded-md h-7 px-3 space-x-1 text-text-secondary cursor-pointer hover:bg-state-base-hover select-none', className)}
      onClick={onClick}>
      <div>
        {iconMap[type]}
      </div>
      <div className='text-xs font-medium'>
        {actionName || t(`common.operation.${type}`)}
      </div>
    </div>
  )
}
export default React.memo(OperationBtn)
