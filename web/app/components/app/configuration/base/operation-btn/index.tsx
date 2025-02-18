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
  add: <RiAddLine className='h-3.5 w-3.5' />,
  edit: <RiEditLine className='h-3.5 w-3.5' />,
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
      className={cn('text-text-secondary hover:bg-state-base-hover flex h-7 cursor-pointer select-none items-center space-x-1 rounded-md px-3', className)}
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
