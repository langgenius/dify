import type * as React from 'react'
import { cn } from '../../cn'
import { IconButton } from '../../icon-button'
import { PopoverClose } from '../../popover'

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

function PickerPanelClose({ label }: { label: string }) {
  return (
    <PopoverClose
      className="shrink-0"
      render={
        <IconButton aria-label={label} size="lg">
          <span
            aria-hidden="true"
            className="i-ri-close-line size-4 forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
          />
        </IconButton>
      }
    />
  )
}

function PickerPanelHeader({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<'div'> & { closeLabel: string }) {
  return (
    <div
      {...props}
      className={cn(
        'flex h-11 shrink-0 items-center justify-between gap-1 border-b-[0.5px] border-divider-regular ps-4 pe-2 system-md-semibold text-text-primary',
        className,
      )}
    >
      {children}
      <PickerPanelClose label={closeLabel} />
    </div>
  )
}

function PickerColumns({ className, ...props }: React.ComponentProps<'div'>) {
  return <div {...props} className={cn('flex h-52 min-h-0 grow gap-1 p-2', className)} />
}

export { PickerColumns, PickerPanel, PickerPanelClose, PickerPanelHeader }
