import { Fragment, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import cn from '@/utils/classnames'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const NewAppDialog = ({
  className,
  children,
  show,
  onClose,
}: DialogProps) => {
  const close = useCallback(() => onClose?.(), [onClose])
  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={close}>
        <TransitionChild
        >
          <div className={
            cn(
              'fixed inset-0 bg-black bg-opacity-25',
              'data-[closed]:opacity-0',
              'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100',
              'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0',
            )

          } />
        </TransitionChild>

        <div className="fixed inset-0">
          <div className="flex flex-col items-center justify-center min-h-full pt-[56px]">
            <TransitionChild>
              <DialogPanel className={cn(
                'grow relative w-full h-[calc(100vh-56px)] p-0 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-t-xl',
                'data-[closed]:opacity-0  data-[closed]:scale-95',
                'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100 data-[enter]:scale-100',
                'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0 data-[enter]:scale-95',
                className)}>
                {children}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default NewAppDialog
