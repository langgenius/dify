import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import cn from '@/utils/classnames'

type DialogWrapperProps = {
  dialogClassName?: string
  className?: string
  panelWrapperClassName?: string
  outerWrapperClassName?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const DialogWrapper = ({
  dialogClassName,
  className,
  panelWrapperClassName,
  outerWrapperClassName,
  children,
  show,
  onClose,
}: DialogWrapperProps) => {
  const close = useCallback(() => onClose?.(), [onClose])
  return (
    <Transition appear show={show}>
      <Dialog
        as='div'
        className={cn('relative z-40', dialogClassName)}
        onClose={close}
      >
        <TransitionChild>
          <div
            className={cn(
              'fixed inset-0 bg-black/25',
              'data-[closed]:opacity-0',
              'data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
              'data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
            )}
          />
        </TransitionChild>

        <div className={cn('fixed inset-0', outerWrapperClassName)}>
          <div className={cn('flex min-h-full flex-col items-end justify-center pb-1 pt-[116px]', panelWrapperClassName)}>
            <TransitionChild>
              <DialogPanel
                className={cn(
                  'relative flex w-[420px] flex-col overflow-hidden border-components-panel-border bg-components-panel-bg-alt p-0 shadow-xl shadow-shadow-shadow-5 transition-all',
                  'data-[closed]:scale-95  data-[closed]:opacity-0',
                  'data-[enter]:scale-100 data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
                  'data-[leave]:scale-95 data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
                  className,
                )}
              >
                {children}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default DialogWrapper
