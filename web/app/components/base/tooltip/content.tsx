import type { FC, PropsWithChildren, ReactNode } from 'react'

export type ToolTipContentProps = {
  title?: ReactNode
  action?: ReactNode
} & PropsWithChildren

export const ToolTipContent: FC<ToolTipContentProps> = ({
  title,
  action,
  children,
}) => {
  return (
    <div className='w-[180px]'>
      {title && (
        <div className='text-text-secondary mb-1.5 font-semibold'>{title}</div>
      )}
      <div className='text-text-tertiary mb-1.5'>{children}</div>
      {action && <div className='text-text-accent cursor-pointer'>{action}</div>}
    </div>
  )
}
