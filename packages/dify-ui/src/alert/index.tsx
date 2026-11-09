'use client'

import type * as React from 'react'
import type { IconButtonProps } from '../icon-button'
import { cn } from '../cn'
import { IconButton } from '../icon-button'
import { mergeProps } from '../merge-props'
import { useRender } from '../use-render'

type AlertProps = React.ComponentProps<'div'> & {
  type: 'info' | 'success' | 'warning' | 'error'
}
type AlertTitleProps = useRender.ComponentProps<'div'>
type AlertDescriptionProps = useRender.ComponentProps<'div'>
type AlertActionsProps = React.ComponentProps<'div'>
type AlertCloseProps = Omit<
  IconButtonProps,
  'children' | 'size' | 'variant' | 'tone' | 'aria-label' | 'aria-labelledby'
> & {
  'aria-label': string
}

function Alert({ type, className, children, role, ...props }: AlertProps) {
  return (
    <div
      role={role ?? (type === 'error' ? 'alert' : 'status')}
      data-type={type}
      className={cn(
        'group/alert relative flex items-start gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]',
        className,
      )}
      {...props}
    >
      {/* Same type-to-halo and type-to-icon mapping as Toast; change both together. */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute -inset-[0.5px] bg-linear-108 to-background-gradient-mask-transparent opacity-40',
          'group-data-[type=info]/alert:from-components-badge-status-light-normal-halo',
          'group-data-[type=success]/alert:from-components-badge-status-light-success-halo',
          'group-data-[type=warning]/alert:from-components-badge-status-light-warning-halo',
          'group-data-[type=error]/alert:from-components-badge-status-light-error-halo',
        )}
      />
      <div className="relative flex shrink-0 items-center justify-center p-1">
        <span
          aria-hidden="true"
          className={cn(
            'size-4',
            'group-data-[type=info]/alert:i-ri-information-2-fill group-data-[type=info]/alert:text-text-accent',
            'group-data-[type=success]/alert:i-ri-checkbox-circle-fill group-data-[type=success]/alert:text-text-success',
            'group-data-[type=warning]/alert:i-ri-alert-fill group-data-[type=warning]/alert:text-text-warning-secondary',
            'group-data-[type=error]/alert:i-ri-error-warning-fill group-data-[type=error]/alert:text-text-destructive',
          )}
        />
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col gap-0.5 py-1 has-data-dify-alert-close:pe-6.5">
        {children}
      </div>
    </div>
  )
}

function AlertTitle({ className, render, ...props }: AlertTitleProps) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        className: cn('system-xs-medium wrap-break-word text-text-primary', className),
      },
      props,
    ),
  })
}

function AlertDescription({ className, render, ...props }: AlertDescriptionProps) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        className: cn('system-xs-regular wrap-break-word text-text-secondary', className),
      },
      props,
    ),
  })
}

function AlertActions({ className, ...props }: AlertActionsProps) {
  return (
    <div className={cn('flex flex-wrap items-start gap-1 pt-1 pb-0.5', className)} {...props} />
  )
}

function AlertClose({ className, 'aria-label': ariaLabel, ...props }: AlertCloseProps) {
  return (
    <IconButton
      aria-label={ariaLabel}
      data-dify-alert-close=""
      size="md"
      className={cn('absolute inset-e-0 top-0', className)}
      {...props}
    >
      <span aria-hidden="true" className="i-ri-close-line size-4" />
    </IconButton>
  )
}

export { Alert, AlertActions, AlertClose, AlertDescription, AlertTitle }
export type {
  AlertActionsProps,
  AlertCloseProps,
  AlertDescriptionProps,
  AlertProps,
  AlertTitleProps,
}
