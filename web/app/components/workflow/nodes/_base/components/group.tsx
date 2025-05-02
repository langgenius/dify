import classNames from '@/utils/classnames'
import type { ComponentProps, FC, PropsWithChildren, ReactNode } from 'react'

export type GroupLabelProps = ComponentProps<'div'>

export const GroupLabel: FC<GroupLabelProps> = (props) => {
  const { children, className, ...rest } = props
  return <div {...rest} className={classNames('mb-1 system-2xs-medium-uppercase text-text-tertiary', className)}>
    {children}
  </div>
}

export type Group = PropsWithChildren<{
  label: ReactNode
}>

export const Group: FC<Group> = (props) => {
  const { children, label } = props
  return <div className={classNames('py-1')}>
    {label}
    <div className='space-y-0.5'>
      {children}
    </div>
  </div>
}
