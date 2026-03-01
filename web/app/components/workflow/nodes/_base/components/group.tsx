import type { ComponentProps, FC, PropsWithChildren, ReactNode } from 'react'
import { cn } from '@/utils/classnames'

export type GroupLabelProps = ComponentProps<'div'>

export const GroupLabel: FC<GroupLabelProps> = (props) => {
  const { children, className, ...rest } = props
  return (
    <div {...rest} className={cn('system-2xs-medium-uppercase mb-1 text-text-tertiary', className)}>
      {children}
    </div>
  )
}

export type GroupProps = PropsWithChildren<{
  label: ReactNode
}>

export const Group: FC<GroupProps> = (props) => {
  const { children, label } = props
  return (
    <div className={cn('py-1')}>
      {label}
      <div className="space-y-0.5">
        {children}
      </div>
    </div>
  )
}
