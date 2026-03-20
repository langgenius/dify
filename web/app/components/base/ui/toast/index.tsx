'use client'

import type {
  ToastManagerAddOptions,
  ToastManagerUpdateOptions,
  ToastObject,
} from '@base-ui/react/toast'
import type { ReactNode } from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

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

export type ToastType = keyof typeof TOAST_TONE_STYLES

export type ToastAddOptions = Omit<ToastManagerAddOptions<ToastData>, 'data' | 'positionerProps' | 'type'> & {
  type?: ToastType
}

export type ToastUpdateOptions = Omit<ToastManagerUpdateOptions<ToastData>, 'data' | 'positionerProps' | 'type'> & {
  type?: ToastType
}

export type ToastOptions = Omit<ToastAddOptions, 'title'>
export type TypedToastOptions = Omit<ToastOptions, 'type'>

type ToastPromiseResultOption<Value> = string | ToastUpdateOptions | ((value: Value) => string | ToastUpdateOptions)

export type ToastPromiseOptions<Value> = {
  loading: string | ToastUpdateOptions
  success: ToastPromiseResultOption<Value>
  error: ToastPromiseResultOption<unknown>
}

export type ToastHostProps = {
  timeout?: number
  limit?: number
}

type ToastDismiss = (toastId?: string) => void
type ToastCall = (title: ReactNode, options?: ToastOptions) => string
type TypedToastCall = (title: ReactNode, options?: TypedToastOptions) => string

export type ToastApi = {
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
  const { t } = useTranslation('common')
  const toastType = getToastType(toastItem.type)

  return (
    <BaseToast.Root
      toast={toastItem}
      className={cn(
        'pointer-events-auto absolute right-0 top-0 w-[360px] max-w-[calc(100vw-2rem)] origin-top cursor-default select-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-hover',
        '[--toast-current-height:var(--toast-frontmost-height,var(--toast-height))] [--toast-gap:8px] [--toast-peek:5px] [--toast-scale:calc(1-(var(--toast-index)*0.0225))] [--toast-shrink:calc(1-var(--toast-scale))]',
        '[height:var(--toast-current-height)] [z-index:calc(100-var(--toast-index))]',
        '[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms] motion-reduce:transition-none',
        'translate-x-[var(--toast-swipe-movement-x)] translate-y-[calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-current-height)))] scale-[var(--toast-scale)]',
        'data-[expanded]:translate-x-[var(--toast-swipe-movement-x)] data-[expanded]:translate-y-[calc(var(--toast-offset-y)+var(--toast-swipe-movement-y)+(var(--toast-index)*8px))] data-[expanded]:scale-100 data-[expanded]:[height:var(--toast-height)]',
        'data-[limited]:pointer-events-none data-[ending-style]:translate-y-[calc(var(--toast-swipe-movement-y)-150%)] data-[starting-style]:-translate-y-[150%] data-[ending-style]:opacity-0 data-[limited]:opacity-0 data-[starting-style]:opacity-0',
        'after:pointer-events-auto after:absolute after:left-0 after:top-full after:h-[calc(var(--toast-gap)+1px)] after:w-full after:content-[\'\']',
      )}
    >
      <div className="relative overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <div
          aria-hidden="true"
          className={cn('absolute inset-[-1px] bg-gradient-to-r opacity-40', getToneGradientClasses(toastType))}
        />
        <BaseToast.Content className="relative flex items-start gap-1 overflow-hidden p-3 transition-opacity duration-200 data-[behind]:opacity-0 data-[expanded]:opacity-100">
          <div className="flex shrink-0 items-center justify-center p-0.5">
            <ToastIcon type={toastType} />
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
        'group/toast-viewport pointer-events-none fixed inset-0 z-[1101] overflow-visible',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute right-4 top-4 w-[360px] max-w-[calc(100vw-2rem)] sm:right-8',
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
