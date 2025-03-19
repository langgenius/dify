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
            'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100',
            'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0',
          )} />
        </TransitionChild>

        <div className="fixed inset-0">
          <div className={cn('flex flex-col items-end justify-center min-h-full pb-2', inWorkflow ? 'pt-[112px]' : 'pt-[64px] pr-2')}>
            <TransitionChild>
              <DialogPanel className={cn(
                'grow flex flex-col relative w-[420px] h-0 p-0 overflow-hidden text-left align-middle transition-all transform bg-components-panel-bg-alt border-components-panel-border shadow-xl',
                inWorkflow ? 'border-t-[0.5px] border-l-[0.5px] border-b-[0.5px] rounded-l-2xl' : 'border-[0.5px] rounded-2xl',
                'data-[closed]:opacity-0  data-[closed]:scale-95',
                'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100 data-[enter]:scale-100',
                'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0 data-[enter]:scale-95',
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
