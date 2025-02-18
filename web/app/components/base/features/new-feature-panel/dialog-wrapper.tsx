import { Fragment, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import cn from '@/utils/classnames'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
  inWorkflow?: boolean
}

const DialogWrapper = ({
  className,
  children,
  show,
  onClose,
  inWorkflow = true,
}: DialogProps) => {
  const close = useCallback(() => onClose?.(), [onClose])
  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={close}>
        <TransitionChild>
          <div className={cn(
            'fixed inset-0 bg-black bg-opacity-25',
            'data-[closed]:opacity-0',
            'data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
            'data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
          )} />
        </TransitionChild>

        <div className="fixed inset-0">
          <div className={cn('flex min-h-full flex-col items-end justify-center pb-2', inWorkflow ? 'pt-[112px]' : 'pr-2 pt-[64px]')}>
            <TransitionChild>
              <DialogPanel className={cn(
                'bg-components-panel-bg-alt border-components-panel-border relative flex h-0 w-[420px] grow flex-col overflow-hidden p-0 text-left align-middle shadow-xl transition-all',
                inWorkflow ? 'rounded-l-2xl border-b-[0.5px] border-l-[0.5px] border-t-[0.5px]' : 'rounded-2xl border-[0.5px]',
                'data-[closed]:scale-95  data-[closed]:opacity-0',
                'data-[enter]:scale-100 data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
                'data-[enter]:scale-95 data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
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
