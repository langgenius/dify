'use client'
import type { FC } from 'react'
import { RiAlertFill, RiCheckboxCircleFill, RiErrorWarningFill, RiInformation2Fill } from '@remixicon/react'
import * as React from 'react'
import Divider from '@/app/components/base/divider'
import { cn } from '@/utils/classnames'

type Status = 'success' | 'error' | 'warning' | 'info'
type Props = {
  type?: Status
  description: string
  actionText?: string
  onAction?: () => void
  disabled?: boolean
}

const IconMap = {
  success: {
    Icon: RiCheckboxCircleFill,
    color: 'text-text-success',
  },
  error: {
    Icon: RiErrorWarningFill,
    color: 'text-text-destructive',
  },
  warning: {
    Icon: RiAlertFill,
    color: 'text-text-warning-secondary',
  },
  info: {
    Icon: RiInformation2Fill,
    color: 'text-text-accent',
  },
}

const getIcon = (type: Status) => {
  return IconMap[type]
}

const StatusAction: FC<Props> = ({
  type = 'info',
  description,
  actionText,
  onAction,
  disabled,
}) => {
  const { Icon, color } = getIcon(type)
  return (
    <div className="relative flex h-[34px] items-center rounded-lg border border-components-panel-border bg-components-panel-bg-blur pl-2 pr-3 shadow-xs">
      <div className={
        `absolute inset-0 rounded-lg opacity-40 ${(type === 'success' && 'bg-[linear-gradient(92deg,rgba(23,178,106,0.25)_0%,rgba(255,255,255,0.00)_100%)]')
        || (type === 'warning' && 'bg-[linear-gradient(92deg,rgba(247,144,9,0.25)_0%,rgba(255,255,255,0.00)_100%)]')
        || (type === 'error' && 'bg-[linear-gradient(92deg,rgba(240,68,56,0.25)_0%,rgba(255,255,255,0.00)_100%)]')
        || (type === 'info' && 'bg-[linear-gradient(92deg,rgba(11,165,236,0.25)_0%,rgba(255,255,255,0.00)_100%)]')
        }`
      }
      />
      <div className="relative z-10 flex h-full items-center space-x-2">
        <Icon className={cn('h-4 w-4', color)} />
        <div className="text-[13px] font-normal text-text-secondary">{description}</div>
        {onAction && (
          <>
            <Divider type="vertical" className="!h-4" />
            <div onClick={onAction} className={cn('cursor-pointer text-[13px] font-semibold text-text-accent', disabled && 'cursor-not-allowed text-text-disabled')}>{actionText}</div>
          </>
        )}
      </div>
    </div>
  )
}
export default React.memo(StatusAction)
