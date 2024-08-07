'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/20/solid'
import cn from '@/utils/classnames'

export type IOperationBtnProps = {
  className?: string
  type: 'add' | 'edit'
  actionName?: string
  onClick?: () => void
}

const iconMap = {
  add: <PlusIcon className='w-3.5 h-3.5' />,
  edit: (<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6.99998 11.6666H12.25M1.75 11.6666H2.72682C3.01217 11.6666 3.15485 11.6666 3.28912 11.6344C3.40816 11.6058 3.52196 11.5587 3.62635 11.4947C3.74408 11.4226 3.84497 11.3217 4.04675 11.1199L11.375 3.79164C11.8583 3.30839 11.8583 2.52488 11.375 2.04164C10.8918 1.55839 10.1083 1.55839 9.62501 2.04164L2.29674 9.3699C2.09496 9.57168 1.99407 9.67257 1.92192 9.7903C1.85795 9.89469 1.81081 10.0085 1.78224 10.1275C1.75 10.2618 1.75 10.4045 1.75 10.6898V11.6666Z" stroke="#344054" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  ),
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
      className={cn(className, 'flex items-center rounded-md h-7 px-3 space-x-1 text-gray-700 cursor-pointer hover:bg-gray-200 select-none')}
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
