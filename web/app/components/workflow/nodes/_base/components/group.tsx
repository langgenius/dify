import type { ComponentProps, FC, PropsWithChildren, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type GroupLabelProps = ComponentProps<'div'>

export const GroupLabel: FC<GroupLabelProps> = (props) => {
  const { children, className, ...rest } = props
  return (
    <div {...rest} className={cn('mb-1 system-2xs-medium-uppercase text-text-tertiary', className)}>
      {children}
    </div>
  )
}

type GroupProps = PropsWithChildren<{
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
