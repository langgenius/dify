import type * as React from 'react'
import { cn } from '../../cn'

type PickerPanelProps = React.ComponentProps<'div'> & {
  header?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  message?: React.ReactNode
}

function PickerPanel({ header, children, footer, message, className, ...props }: PickerPanelProps) {
  return (
    <div {...props} className={cn('flex min-h-0 grow flex-col overflow-hidden', className)}>
      {header}
      {children}
      {message && <div className="shrink-0">{message}</div>}
      {footer && (
        <div className="flex h-10 shrink-0 items-center justify-between gap-1 border-t-[0.5px] border-divider-regular px-2">
          {footer}
        </div>
      )}
    </div>
  )
}

function PickerPanelHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'flex h-11 shrink-0 items-center border-b-[0.5px] border-divider-regular px-4 system-md-semibold text-text-primary',
        className,
      )}
    />
  )
}

function PickerColumns({ className, ...props }: React.ComponentProps<'div'>) {
  return <div {...props} className={cn('flex h-52 min-h-0 grow gap-1 p-2', className)} />
}

export { PickerColumns, PickerPanel, PickerPanelHeader }
