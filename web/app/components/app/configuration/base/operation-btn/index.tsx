'use client'
import type { FC } from 'react'
import {
  RiAddLine,
  RiEditLine,
} from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

export type IOperationBtnProps = {
  className?: string
  type: 'add' | 'edit'
  actionName?: string
  onClick?: () => void
}

const iconMap = {
  add: <RiAddLine className="h-3.5 w-3.5" />,
  edit: <RiEditLine className="h-3.5 w-3.5" />,
}

const OperationBtn: FC<IOperationBtnProps> = ({
  className,
  type,
  actionName,
  onClick = noop,
}) => {
  const { t } = useTranslation()
  return (
    <div
      className={cn('flex h-7 cursor-pointer select-none items-center space-x-1 rounded-md px-3 text-text-secondary hover:bg-state-base-hover', className)}
      onClick={onClick}
    >
      <div>
        {iconMap[type]}
      </div>
      <div className="text-xs font-medium">
        {actionName || t(`operation.${type}`, { ns: 'common' })}
      </div>
    </div>
  )
}
export default React.memo(OperationBtn)
