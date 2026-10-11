'use client'

import type {
  ToastManager as BaseToastManager,
  ToastManagerAddOptions,
  ToastManagerUpdateOptions,
  ToastObject,
} from '@base-ui/react/toast'
import type * as React from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { cn } from '../cn'
import { iconButtonVariants } from '../icon-button/variants'

type ToastData = Record<string, never>
// `loading` is reserved for `promise`, which resolves it into `success` or `error`.
type ToastType = 'success' | 'error' | 'warning' | 'info'

const toastCloseLabel = 'Close notification'

type ToastAddOptions = Omit<
  ToastManagerAddOptions<ToastData>,
  'data' | 'positionerProps' | 'type'
> & {
  type?: ToastType
}

type ToastUpdateOptions = Omit<
  ToastManagerUpdateOptions<ToastData>,
  'data' | 'positionerProps' | 'type'
> & {
  type?: ToastType
}

// Every toast carries a tone: the callable form takes it as an option, the shortcuts fix it.
type TypedToastOptions = Omit<ToastAddOptions, 'title' | 'type'>
type ToastOptions = TypedToastOptions & { type: ToastType }

type ToastPromiseResultOption<Value> =
  | string
  | ToastUpdateOptions
  | ((value: Value) => string | ToastUpdateOptions)

type ToastPromiseOptions<Value> = {
  loading: string | ToastUpdateOptions
  success: ToastPromiseResultOption<Value>
  error: ToastPromiseResultOption<unknown>
}

type ToastCardProps = {
  toast: ToastObject<ToastData>
  /** Additional content composed inside the card. */
  children?: React.ReactNode
}

type ToasterOffset = Pick<React.CSSProperties, 'top' | 'right'>

// `children` fills the viewport and defaults to a `ToastCard` per toast; compose `useToasts` to
// customize it.
type ToasterProps = Pick<BaseToast.Provider.Props, 'timeout' | 'limit'> &
  Pick<BaseToast.Viewport.Props, 'children'> & {
    toastManager: ToastManager
    offset?: ToasterOffset
  }

type ToastDismiss = (toastId?: string) => void
type ToastCall = (title: React.ReactNode, options: ToastOptions) => string
type TypedToastCall = (title: React.ReactNode, options?: TypedToastOptions) => string

type ToastApi = {
  (title: React.ReactNode, options: ToastOptions): string
  success: TypedToastCall
  error: TypedToastCall
  warning: TypedToastCall
  info: TypedToastCall
  dismiss: ToastDismiss
  update: (toastId: string, options: ToastUpdateOptions) => void
  promise: <Value>(
    promiseValue: Promise<Value>,
    options: ToastPromiseOptions<Value>,
  ) => Promise<Value>
}

type ToastManager = BaseToastManager<ToastData>

// Base UI reads a bare string as the description; this API reads it as the title.
function toTitleOptions(option: string | ToastUpdateOptions): ToastUpdateOptions {
  return typeof option === 'string' ? { title: option } : option
}

function toTitleResultOption<Value>(option: ToastPromiseResultOption<Value>) {
  return typeof option === 'function'
    ? (value: Value) => toTitleOptions(option(value))
    : toTitleOptions(option)
}

function createToast(manager: ToastManager): ToastApi {
  const addToast = (options: ToastAddOptions) => manager.add(options)
  const showToast: ToastCall = (title, options) =>
    addToast({
      ...options,
      title,
    })

  const dismissToast: ToastDismiss = (toastId) => {
    manager.close(toastId)
  }

  const createTypedToast = (type: ToastType): TypedToastCall => {
    return (title, options) =>
      addToast({
        ...options,
        title,
        type,
      })
  }

  const updateToast = (toastId: string, options: ToastUpdateOptions) => {
    manager.update(toastId, options)
  }

  const promiseToast = <Value,>(
    promiseValue: Promise<Value>,
    options: ToastPromiseOptions<Value>,
  ) =>
    manager.promise(promiseValue, {
      loading: toTitleOptions(options.loading),
      success: toTitleResultOption(options.success),
      error: toTitleResultOption(options.error),
    })

  return Object.assign(showToast, {
    success: createTypedToast('success'),
    error: createTypedToast('error'),
    warning: createTypedToast('warning'),
    info: createTypedToast('info'),
    dismiss: dismissToast,
    update: updateToast,
    promise: promiseToast,
  })
}

function createToastManager(): ToastManager {
  return BaseToast.createToastManager<ToastData>()
}

function ToastCard({ toast: toastItem, children }: ToastCardProps) {
  return (
    <BaseToast.Root
      toast={toastItem}
      swipeDirection={['up', 'right']}
      className={cn(
        'group/toast pointer-events-auto absolute top-0 right-0 w-full origin-top cursor-default rounded-xl select-none focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        '[--toast-current-height:var(--toast-frontmost-height,var(--toast-height))] [--toast-expanded-offset-y:calc(var(--toast-offset-y)+var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-gap)))] [--toast-gap:8px] [--toast-peek:5px] [--toast-scale:calc(1-(var(--toast-index)*0.0225))] [--toast-shrink:calc(1-var(--toast-scale))]',
        'z-[calc(100-var(--toast-index))] h-(--toast-current-height)',
        '[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms] motion-reduce:transition-none',
        'transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-current-height))))_scale(var(--toast-scale))]',
        'data-expanded:h-(--toast-height) data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-expanded-offset-y))_scale(1)]',
        'data-ending-style:pointer-events-none data-ending-style:transform-[translateY(-150%)] data-ending-style:opacity-0 data-ending-style:after:pointer-events-none',
        'data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))]',
        'data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--toast-expanded-offset-y))]',
        'data-limited:opacity-0 data-starting-style:transform-[translateY(-150%)] data-starting-style:opacity-0',
        "after:pointer-events-auto after:absolute after:bottom-full after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full after:content-['']",
      )}
    >
      <div className="relative h-full overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <div
          aria-hidden="true"
          className={cn(
            'absolute -inset-px bg-linear-to-r to-background-gradient-mask-transparent opacity-40',
            'group-data-[type=loading]/toast:from-components-badge-status-light-normal-halo',
            'group-data-[type=info]/toast:from-components-badge-status-light-normal-halo',
            'group-data-[type=success]/toast:from-components-badge-status-light-success-halo',
            'group-data-[type=warning]/toast:from-components-badge-status-light-warning-halo',
            'group-data-[type=error]/toast:from-components-badge-status-light-error-halo',
          )}
        />
        <BaseToast.Content className="relative flex items-start gap-1 overflow-hidden p-3 transition-opacity duration-200 data-behind:opacity-0 data-expanded:opacity-100 motion-reduce:transition-none">
          <div className="flex shrink-0 items-center justify-center p-0.5">
            <span
              aria-hidden="true"
              className={cn(
                // Each tone sets its own size: the icon utility carries a 1rem size that only a
                // utility under the same variant overrides.
                'group-data-[type=loading]/toast:i-ri-loader-2-line group-data-[type=loading]/toast:size-5 group-data-[type=loading]/toast:animate-spin group-data-[type=loading]/toast:text-text-accent motion-reduce:animate-none',
                'group-data-[type=info]/toast:i-ri-information-2-fill group-data-[type=info]/toast:size-5 group-data-[type=info]/toast:text-text-accent',
                'group-data-[type=success]/toast:i-ri-checkbox-circle-fill group-data-[type=success]/toast:size-5 group-data-[type=success]/toast:text-text-success',
                'group-data-[type=warning]/toast:i-ri-alert-fill group-data-[type=warning]/toast:size-5 group-data-[type=warning]/toast:text-text-warning-secondary',
                'group-data-[type=error]/toast:i-ri-error-warning-fill group-data-[type=error]/toast:size-5 group-data-[type=error]/toast:text-text-destructive',
              )}
            />
          </div>
          <div className="min-w-0 flex-1 p-1">
            <BaseToast.Title className="min-w-0 system-sm-semibold wrap-break-word text-text-primary" />
            <BaseToast.Description className="mt-1 min-w-0 system-xs-regular wrap-break-word text-text-secondary" />
            <BaseToast.Action
              className={cn(
                'mt-2 mb-1 flex w-fit items-center justify-center overflow-hidden rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 system-sm-medium text-components-button-secondary-text shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]',
                'hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
              )}
            />
          </div>
          {children}
          <div className="flex shrink-0 items-center justify-center rounded-md p-0.5">
            <BaseToast.Close
              aria-label={toastCloseLabel}
              className={cn(
                iconButtonVariants({ size: 'sm' }),
                'focus-visible:bg-state-base-hover',
              )}
            >
              <span aria-hidden="true" className="i-ri-close-line size-4 text-text-tertiary" />
            </BaseToast.Close>
          </div>
        </BaseToast.Content>
      </div>
    </BaseToast.Root>
  )
}

function useToasts(): ToastObject<ToastData>[] {
  return BaseToast.useToastManager<ToastData>().toasts
}

function ToastCards() {
  const toasts = useToasts()
  return toasts.map((item) => <ToastCard key={item.id} toast={item} />)
}

function Toaster({
  toastManager,
  timeout,
  limit,
  offset,
  children = <ToastCards />,
}: ToasterProps) {
  return (
    <BaseToast.Provider toastManager={toastManager} timeout={timeout} limit={limit}>
      <BaseToast.Portal>
        <BaseToast.Viewport
          className="pointer-events-none fixed top-4 right-4 z-60 w-90 max-w-[calc(100vw-2rem)] overflow-visible sm:right-8"
          style={offset}
        >
          {children}
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}

export { createToast, createToastManager, ToastCard, Toaster, useToasts }

export type { ToastApi, ToastCardProps, ToasterProps, ToastManager, ToastType }
