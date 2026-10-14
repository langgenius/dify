'use client'
import type { VariantProps } from 'class-variance-authority'
import type { CSSProperties } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'
import * as React from 'react'

export const NodeStatusEnum = {
  warning: 'warning',
  error: 'error',
} as const

export type NodeStatusEnum = (typeof NodeStatusEnum)[keyof typeof NodeStatusEnum]

const nodeStatusVariants = cva('flex items-center gap-1 rounded-md px-2 py-1 system-xs-medium', {
  variants: {
    status: {
      [NodeStatusEnum.warning]: 'bg-state-warning-hover text-text-warning',
      [NodeStatusEnum.error]: 'bg-state-destructive-hover text-text-destructive',
    },
  },
  defaultVariants: {
    status: NodeStatusEnum.warning,
  },
})

const StatusIconMap: Record<NodeStatusEnum, { iconClassName: string; message: string }> = {
  [NodeStatusEnum.warning]: {
    iconClassName: 'i-custom-vender-solid-alertsAndFeedback-alert-triangle',
    message: 'Warning',
  },
  [NodeStatusEnum.error]: { iconClassName: 'i-ri-error-warning-fill', message: 'Error' },
}

type NodeStatusProps = {
  message?: string
  styleCss?: CSSProperties
  iconClassName?: string
} & React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof nodeStatusVariants>

const NodeStatus = ({
  className,
  status,
  message,
  styleCss,
  iconClassName,
  children,
  ...props
}: NodeStatusProps) => {
  const statusIconClassName = StatusIconMap[status ?? NodeStatusEnum.warning].iconClassName
  const defaultMessage = StatusIconMap[status ?? NodeStatusEnum.warning].message

  return (
    <div className={cn(nodeStatusVariants({ status, className }))} style={styleCss} {...props}>
      <span aria-hidden className={cn(statusIconClassName, 'size-3.5 shrink-0', iconClassName)} />
      <span>{message ?? defaultMessage}</span>
      {children}
    </div>
  )
}

NodeStatus.displayName = 'NodeStatus'

export default React.memo(NodeStatus)
