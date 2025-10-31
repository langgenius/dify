'use client'
import AlertTriangle from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback/AlertTriangle'
import classNames from '@/utils/classnames'
import { RiErrorWarningFill } from '@remixicon/react'
import { type VariantProps, cva } from 'class-variance-authority'
import type { CSSProperties } from 'react'
import React from 'react'

export enum NodeStatusEnum {
  warning = 'warning',
  error = 'error',
}

const nodeStatusVariants = cva(
  'flex items-center gap-1 rounded-md px-2 py-1 system-xs-medium',
  {
    variants: {
      status: {
        [NodeStatusEnum.warning]: 'bg-state-warning-hover text-text-warning',
        [NodeStatusEnum.error]: 'bg-state-destructive-hover text-text-destructive',
      },
    },
    defaultVariants: {
      status: NodeStatusEnum.warning,
    },
  },
)

const StatusIconMap: Record<NodeStatusEnum, { IconComponent: React.ElementType; message: string }> = {
  [NodeStatusEnum.warning]: { IconComponent: AlertTriangle, message: 'Warning' },
  [NodeStatusEnum.error]: { IconComponent: RiErrorWarningFill, message: 'Error' },
}

export type NodeStatusProps = {
  message?: string
  styleCss?: CSSProperties
  iconClassName?: string
} & React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof nodeStatusVariants>

const NodeStatus = ({
  className,
  status,
  message,
  styleCss,
  iconClassName,
  children,
  ...props
}: NodeStatusProps) => {
  const Icon = StatusIconMap[status ?? NodeStatusEnum.warning].IconComponent
  const defaultMessage = StatusIconMap[status ?? NodeStatusEnum.warning].message

  return (
    <div
      className={classNames(
        nodeStatusVariants({ status, className }),
      )}
      style={styleCss}
      {...props}
    >
      <Icon
        className={classNames(
          'h-3.5 w-3.5 shrink-0',
          iconClassName,
        )}
      />
      <span>{message ?? defaultMessage}</span>
      {children}
    </div>
  )
}

NodeStatus.displayName = 'NodeStatus'

export default React.memo(NodeStatus)
