import { Fragment, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import cn from '@/utils/classnames'

type DialogWrapperProps = {
  className?: string
  panelWrapperClassName?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const DialogWrapper = ({
  className,
  panelWrapperClassName,
  children,
  show,
  onClose,
}: DialogWrapperProps) => {
  const close = useCallback(() => onClose?.(), [onClose])
  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as='div' className='relative z-[1000001]' onClose={close}>
        <TransitionChild>
          <div className={cn(
            'fixed inset-0 bg-black/25',
            'data-[closed]:opacity-0',
            'data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
            'data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
          )} />
        </TransitionChild>

        <div className='fixed inset-0'>
          <div className={cn('flex min-h-full flex-col items-end justify-start pb-1 pt-[116px]', panelWrapperClassName)}>
            <TransitionChild>
              <DialogPanel className={cn(
                'relative flex w-[480px] grow flex-col overflow-hidden rounded-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl shadow-shadow-shadow-5 transition-all',
                'data-[closed]:scale-95 data-[closed]:opacity-0',
                'data-[enter]:scale-100 data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
                'data-[leave]:scale-95 data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
                className,
              )}>
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
