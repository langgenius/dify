'use client'

import type {
  ToastManagerAddOptions,
  ToastManagerUpdateOptions,
  ToastObject,
} from '@base-ui/react/toast'
import type { ReactNode } from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { cn } from '../cn'

type ToastData = Record<string, never>
type ToastToneStyle = {
  gradientClassName: string
  iconClassName: string
}

const TOAST_TONE_STYLES = {
  success: {
    iconClassName: 'i-ri-checkbox-circle-fill text-text-success',
    gradientClassName: 'from-components-badge-status-light-success-halo to-background-gradient-mask-transparent',
  },
  error: {
    iconClassName: 'i-ri-error-warning-fill text-text-destructive',
    gradientClassName: 'from-components-badge-status-light-error-halo to-background-gradient-mask-transparent',
  },
  warning: {
    iconClassName: 'i-ri-alert-fill text-text-warning-secondary',
    gradientClassName: 'from-components-badge-status-light-warning-halo to-background-gradient-mask-transparent',
  },
  info: {
    iconClassName: 'i-ri-information-2-fill text-text-accent',
    gradientClassName: 'from-components-badge-status-light-normal-halo to-background-gradient-mask-transparent',
  },
} satisfies Record<string, ToastToneStyle>

const toastCloseLabel = 'Close notification'
const toastViewportLabel = 'Notifications'

type ToastType = keyof typeof TOAST_TONE_STYLES

type ToastAddOptions = Omit<ToastManagerAddOptions<ToastData>, 'data' | 'positionerProps' | 'type'> & {
  type?: ToastType
}

type ToastUpdateOptions = Omit<ToastManagerUpdateOptions<ToastData>, 'data' | 'positionerProps' | 'type'> & {
  type?: ToastType
}

type ToastOptions = Omit<ToastAddOptions, 'title'>
type TypedToastOptions = Omit<ToastOptions, 'type'>

type ToastPromiseResultOption<Value> = string | ToastUpdateOptions | ((value: Value) => string | ToastUpdateOptions)

type ToastPromiseOptions<Value> = {
  loading: string | ToastUpdateOptions
  success: ToastPromiseResultOption<Value>
  error: ToastPromiseResultOption<unknown>
}

type ToastHostProps = {
  timeout?: number
  limit?: number
}

type ToastDismiss = (toastId?: string) => void
type ToastCall = (title: ReactNode, options?: ToastOptions) => string
type TypedToastCall = (title: ReactNode, options?: TypedToastOptions) => string

type ToastApi = {
  (title: ReactNode, options?: ToastOptions): string
  success: TypedToastCall
  error: TypedToastCall
  warning: TypedToastCall
  info: TypedToastCall
  dismiss: ToastDismiss
  update: (toastId: string, options: ToastUpdateOptions) => void
  promise: <Value>(promiseValue: Promise<Value>, options: ToastPromiseOptions<Value>) => Promise<Value>
}

const toastManager = BaseToast.createToastManager<ToastData>()

function isToastType(type: string): type is ToastType {
  return Object.prototype.hasOwnProperty.call(TOAST_TONE_STYLES, type)
}

function getToastType(type?: string): ToastType | undefined {
  return type && isToastType(type) ? type : undefined
}

function addToast(options: ToastAddOptions) {
  return toastManager.add(options)
}

const showToast: ToastCall = (title, options) => addToast({
  ...options,
  title,
})

const dismissToast: ToastDismiss = (toastId) => {
  toastManager.close(toastId)
}

function createTypedToast(type: ToastType): TypedToastCall {
  return (title, options) => addToast({
    ...options,
    title,
    type,
  })
}

function updateToast(toastId: string, options: ToastUpdateOptions) {
  toastManager.update(toastId, options)
}

function promiseToast<Value>(promiseValue: Promise<Value>, options: ToastPromiseOptions<Value>) {
  return toastManager.promise(promiseValue, options)
}

export const toast: ToastApi = Object.assign(
  showToast,
  {
    success: createTypedToast('success'),
    error: createTypedToast('error'),
    warning: createTypedToast('warning'),
    info: createTypedToast('info'),
    dismiss: dismissToast,
    update: updateToast,
    promise: promiseToast,
  },
)

function ToastIcon({ type }: { type?: ToastType }) {
  return type
    ? <span aria-hidden="true" className={cn('h-5 w-5', TOAST_TONE_STYLES[type].iconClassName)} />
    : null
}

function getToneGradientClasses(type?: ToastType) {
  if (type)
    return TOAST_TONE_STYLES[type].gradientClassName
  return 'from-background-default-subtle to-background-gradient-mask-transparent'
}

function ToastCard({
  toast: toastItem,
}: {
  toast: ToastObject<ToastData>
}) {
  const toastType = getToastType(toastItem.type)

  return (
    <BaseToast.Root
      toast={toastItem}
      className={cn(
        'pointer-events-auto absolute top-0 right-0 w-[360px] max-w-[calc(100vw-2rem)] origin-top cursor-default rounded-xl select-none focus-visible:ring-2 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden',
        '[--toast-current-height:var(--toast-frontmost-height,var(--toast-height))] [--toast-gap:8px] [--toast-peek:5px] [--toast-scale:calc(1-(var(--toast-index)*0.0225))] [--toast-shrink:calc(1-var(--toast-scale))]',
        'z-[calc(100-var(--toast-index))] h-(--toast-current-height)',
        '[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms] motion-reduce:transition-none',
        '[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-current-height))))_scale(var(--toast-scale))]',
        'data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-offset-y)+var(--toast-swipe-movement-y)+(var(--toast-index)*8px)))_scale(1)]',
        'data-ending-style:[transform:translateY(-150%)] data-ending-style:opacity-0',
        'data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]',
        'data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))]',
        'data-limited:pointer-events-none data-limited:opacity-0 data-starting-style:[transform:translateY(-150%)] data-starting-style:opacity-0',
        'after:pointer-events-auto after:absolute after:top-full after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full after:content-[\'\']',
      )}
    >
      <div className="relative overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <div
          aria-hidden="true"
          className={cn('absolute -inset-px bg-linear-to-r opacity-40', getToneGradientClasses(toastType))}
        />
        <BaseToast.Content className="relative flex items-start gap-1 overflow-hidden p-3 transition-opacity duration-200 data-behind:opacity-0 data-expanded:opacity-100">
          <div className="flex shrink-0 items-center justify-center p-0.5">
            <ToastIcon type={toastType} />
          </div>
          <div className="min-w-0 flex-1 p-1">
            <div className="flex w-full items-center gap-1">
              {toastItem.title != null && (
                <BaseToast.Title className="system-sm-semibold wrap-break-word text-text-primary">
                  {toastItem.title}
                </BaseToast.Title>
              )}
            </div>
            {toastItem.description != null && (
              <BaseToast.Description className="mt-1 system-xs-regular wrap-break-word text-text-secondary">
                {toastItem.description}
              </BaseToast.Description>
            )}
            {toastItem.actionProps && (
              <div className="flex w-full items-start gap-1 pt-2 pb-1">
                <BaseToast.Action
                  className={cn(
                    'inline-flex items-center justify-center overflow-hidden rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 system-sm-medium text-components-button-secondary-text shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]',
                    'hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden',
                  )}
                />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-center rounded-md p-0.5">
            <BaseToast.Close
              aria-label={toastCloseLabel}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-md hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <span aria-hidden="true" className="i-ri-close-line h-4 w-4 text-text-tertiary" />
            </BaseToast.Close>
          </div>
        </BaseToast.Content>
      </div>
    </BaseToast.Root>
  )
}

function ToastViewport() {
  const { toasts } = BaseToast.useToastManager<ToastData>()

  return (
    <BaseToast.Viewport
      aria-label={toastViewportLabel}
      className={cn(
        'group/toast-viewport pointer-events-none fixed inset-0 z-60 overflow-visible',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute top-4 right-4 w-[360px] max-w-[calc(100vw-2rem)] sm:right-8',
        )}
      >
        {toasts.map(toastItem => (
          <ToastCard
            key={toastItem.id}
            toast={toastItem}
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
