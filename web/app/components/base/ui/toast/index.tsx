'use client'

import type {
  ToastManagerAddOptions,
  ToastManagerPromiseOptions,
  ToastManagerUpdateOptions,
  ToastObject,
} from '@base-ui/react/toast'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type ToastData = Record<string, never>
type ToastType = 'success' | 'error' | 'warning' | 'info'

type ToastAddOptions = Omit<ToastManagerAddOptions<ToastData>, 'data' | 'positionerProps' | 'type'> & {
  type?: ToastType
}

type ToastUpdateOptions = Omit<ToastManagerUpdateOptions<ToastData>, 'data' | 'positionerProps' | 'type'> & {
  type?: ToastType
}

type ToastPromiseOptions<Value> = {
  loading: string | ToastUpdateOptions
  success: string | ToastUpdateOptions | ((result: Value) => string | ToastUpdateOptions)
  error: string | ToastUpdateOptions | ((error: unknown) => string | ToastUpdateOptions)
}

export type ToastHostProps = {
  timeout?: number
  limit?: number
}

const toastManager = BaseToast.createToastManager<ToastData>()

export const toast = {
  add(options: ToastAddOptions) {
    return toastManager.add(options)
  },
  close(toastId?: string) {
    toastManager.close(toastId)
  },
  update(toastId: string, options: ToastUpdateOptions) {
    toastManager.update(toastId, options)
  },
  promise<Value>(promiseValue: Promise<Value>, options: ToastPromiseOptions<Value>) {
    return toastManager.promise(promiseValue, options as ToastManagerPromiseOptions<Value, ToastData>)
  },
}

function ToastIcon({ type }: { type?: string }) {
  if (type === 'success') {
    return <span aria-hidden="true" className="i-ri-checkbox-circle-fill h-5 w-5 text-text-success" />
  }

  if (type === 'error') {
    return <span aria-hidden="true" className="i-ri-error-warning-fill h-5 w-5 text-text-destructive" />
  }

  if (type === 'warning') {
    return <span aria-hidden="true" className="i-ri-alert-fill h-5 w-5 text-text-warning-secondary" />
  }

  if (type === 'info') {
    return <span aria-hidden="true" className="i-ri-information-2-fill h-5 w-5 text-text-accent" />
  }

  return null
}

function getToneGradientClasses(type?: string) {
  if (type === 'success')
    return 'from-components-badge-status-light-success-halo to-background-gradient-mask-transparent'

  if (type === 'error')
    return 'from-components-badge-status-light-error-halo to-background-gradient-mask-transparent'

  if (type === 'warning')
    return 'from-components-badge-status-light-warning-halo to-background-gradient-mask-transparent'

  if (type === 'info')
    return 'from-components-badge-status-light-normal-halo to-background-gradient-mask-transparent'

  return 'from-background-default-subtle to-background-gradient-mask-transparent'
}

function ToastCard({
  toast: toastItem,
  showHoverBridge = false,
}: {
  toast: ToastObject<ToastData>
  showHoverBridge?: boolean
}) {
  const { t } = useTranslation('common')

  return (
    <BaseToast.Root
      toast={toastItem}
      className={cn(
        'pointer-events-auto absolute right-0 top-0 w-[360px] max-w-[calc(100vw-2rem)] origin-top-right outline-none',
        '[height:var(--toast-frontmost-height)] [z-index:calc(100-var(--toast-index))] data-[expanded]:[height:var(--toast-height)]',
        'transition-[transform,opacity] duration-200 ease-out data-[limited]:pointer-events-none data-[ending-style]:opacity-0 data-[limited]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none',
        'translate-y-[calc(var(--toast-index)*6px)] scale-[calc(1-var(--toast-index)*0.03)]',
        'data-[expanded]:translate-y-[calc(var(--toast-offset-y)+var(--toast-index)*8px)] data-[expanded]:scale-100',
      )}
    >
      <div className="relative overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <div
          aria-hidden="true"
          className={cn('absolute inset-[-1px] bg-gradient-to-r opacity-40', getToneGradientClasses(toastItem.type))}
        />
        <BaseToast.Content className="relative flex items-start gap-1 overflow-hidden p-3 transition-opacity duration-150 data-[behind]:opacity-0 data-[expanded]:opacity-100">
          <div className="flex shrink-0 items-center justify-center p-0.5">
            <ToastIcon type={toastItem.type} />
          </div>
          <div className="min-w-0 flex-1 p-1">
            <div className="flex w-full items-center gap-1">
              {toastItem.title != null && (
                <BaseToast.Title className="break-words text-text-primary system-sm-semibold">
                  {toastItem.title}
                </BaseToast.Title>
              )}
            </div>
            {toastItem.description != null && (
              <BaseToast.Description className="mt-1 break-words text-text-secondary system-xs-regular">
                {toastItem.description}
              </BaseToast.Description>
            )}
            {toastItem.actionProps && (
              <div className="flex w-full items-start gap-1 pb-1 pt-2">
                <BaseToast.Action
                  className={cn(
                    'inline-flex items-center justify-center overflow-hidden rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 text-components-button-secondary-text shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] system-sm-medium',
                    'hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-components-input-border-hover',
                  )}
                />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-center rounded-md p-0.5">
            <BaseToast.Close
              aria-label={t('toast.close')}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-md hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-components-input-border-hover disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <span aria-hidden="true" className="i-ri-close-line h-4 w-4 text-text-tertiary" />
            </BaseToast.Close>
          </div>
        </BaseToast.Content>
      </div>
      {showHoverBridge && (
        <div aria-hidden="true" className="absolute inset-x-0 -bottom-2 h-2" />
      )}
    </BaseToast.Root>
  )
}

function ToastViewport() {
  const { t } = useTranslation('common')
  const { toasts } = BaseToast.useToastManager<ToastData>()

  return (
    <BaseToast.Viewport
      aria-label={t('toast.notifications')}
      className={cn(
        // During overlay migration, toast must stay above legacy highPriority modals (z-[1100]).
        'pointer-events-none fixed inset-0 z-[1101] overflow-visible',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute right-4 top-4 w-[360px] max-w-[calc(100vw-2rem)] sm:right-8 sm:top-8',
        )}
      >
        {toasts.map((toastItem, index) => (
          <ToastCard
            key={toastItem.id}
            toast={toastItem}
            showHoverBridge={index < toasts.length - 1}
          />
        ))}
      </div>
    </BaseToast.Viewport>
  )
}

export function ToastHost({
  timeout,
  limit,
}: ToastHostProps) {
  return (
    <BaseToast.Provider toastManager={toastManager} timeout={timeout} limit={limit}>
      <BaseToast.Portal>
        <ToastViewport />
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}
