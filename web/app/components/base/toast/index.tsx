'use client'

/**
 * @deprecated Use `@/app/components/base/ui/toast` instead.
 * This component will be removed after migration is complete.
 * See: https://github.com/langgenius/dify/issues/32811
 */

import type { ReactNode } from 'react'
import type { IToastProps } from './context'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ActionButton from '@/app/components/base/action-button'
import { cn } from '@/utils/classnames'
import { ToastContext, useToastContext } from './context'

export type ToastHandle = {
  clear?: VoidFunction
}

const Toast = ({
  type = 'info',
  size = 'md',
  message,
  children,
  className,
  customComponent,
}: IToastProps) => {
  const { close } = useToastContext()
  // sometimes message is react node array. Not handle it.
  if (typeof message !== 'string')
    return null

  return (
    <div className={cn(
      className,
      // Keep legacy toast above highPriority modals until overlay migration completes.
      'fixed z-[1101] mx-8 my-4 w-[360px] grow overflow-hidden rounded-xl',
      'border border-components-panel-border-subtle bg-components-panel-bg-blur shadow-sm',
      'top-0',
      'right-0',
      size === 'md' ? 'p-3' : 'p-2',
      className,
    )}
    >
      <div className={cn(
        'absolute inset-0 -z-10 opacity-40',
        type === 'success' && 'bg-toast-success-bg',
        type === 'warning' && 'bg-toast-warning-bg',
        type === 'error' && 'bg-toast-error-bg',
        type === 'info' && 'bg-toast-info-bg',
      )}
      />
      <div className={cn('flex', size === 'md' ? 'gap-1' : 'gap-0.5')}>
        <div className={cn('flex items-center justify-center', size === 'md' ? 'p-0.5' : 'p-1')}>
          {type === 'success' && <span className={cn('i-ri-checkbox-circle-fill', 'text-text-success', size === 'md' ? 'h-5 w-5' : 'h-4 w-4')} data-testid="toast-icon-success" aria-hidden="true" />}
          {type === 'error' && <span className={cn('i-ri-error-warning-fill', 'text-text-destructive', size === 'md' ? 'h-5 w-5' : 'h-4 w-4')} data-testid="toast-icon-error" aria-hidden="true" />}
          {type === 'warning' && <span className={cn('i-ri-alert-fill', 'text-text-warning-secondary', size === 'md' ? 'h-5 w-5' : 'h-4 w-4')} data-testid="toast-icon-warning" aria-hidden="true" />}
          {type === 'info' && <span className={cn('i-ri-information-2-fill', 'text-text-accent', size === 'md' ? 'h-5 w-5' : 'h-4 w-4')} data-testid="toast-icon-info" aria-hidden="true" />}
        </div>
        <div className={cn('flex grow flex-col items-start gap-1 py-1', size === 'md' ? 'px-1' : 'px-0.5')}>
          <div className="flex items-center gap-1">
            <div className="text-text-primary system-sm-semibold [word-break:break-word]">{message}</div>
            {customComponent}
          </div>
          {!!children && (
            <div className="text-text-secondary system-xs-regular">
              {children}
            </div>
          )}
        </div>
        {close
          && (
            <ActionButton data-testid="toast-close-button" className="z-[1000]" onClick={close}>
              <span className="i-ri-close-line h-4 w-4 shrink-0 text-text-tertiary" />
            </ActionButton>
          )}
      </div>
    </div>
  )
}

/** @deprecated Use `@/app/components/base/ui/toast` instead. See issue #32811. */
export const ToastProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const placeholder: IToastProps = {
    type: 'info',
    message: 'Toast message',
    duration: 6000,
  }
  const [params, setParams] = React.useState<IToastProps>(placeholder)
  const defaultDuring = (params.type === 'success' || params.type === 'info') ? 3000 : 6000
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (mounted) {
      setTimeout(() => {
        setMounted(false)
      }, params.duration || defaultDuring)
    }
  }, [defaultDuring, mounted, params.duration])

  return (
    <ToastContext.Provider value={{
      notify: (props) => {
        setMounted(true)
        setParams(props)
      },
      close: () => setMounted(false),
    }}
    >
      {mounted && <Toast {...params} />}
      {children}
    </ToastContext.Provider>
  )
}

Toast.notify = ({
  type,
  size = 'md',
  message,
  duration,
  className,
  customComponent,
  onClose,
}: Pick<IToastProps, 'type' | 'size' | 'message' | 'duration' | 'className' | 'customComponent' | 'onClose'>): ToastHandle => {
  const defaultDuring = (type === 'success' || type === 'info') ? 3000 : 6000
  const toastHandler: ToastHandle = {}

  if (typeof window === 'object') {
    const holder = document.createElement('div')
    const root = createRoot(holder)

    toastHandler.clear = () => {
      if (holder) {
        root.unmount()
        holder.remove()
      }
      onClose?.()
    }

    root.render(
      <ToastContext.Provider value={{
        notify: noop,
        close: () => {
          if (holder) {
            root.unmount()
            holder.remove()
          }
          onClose?.()
        },
      }}
      >
        <Toast type={type} size={size} message={message} duration={duration} className={className} customComponent={customComponent} />
      </ToastContext.Provider>,
    )
    document.body.appendChild(holder)
    const d = duration ?? defaultDuring
    if (d > 0)
      setTimeout(toastHandler.clear, d)
  }

  return toastHandler
}

export default Toast

export type { IToastProps } from './context'
