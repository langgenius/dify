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
              'data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
              'data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
            )

          } />
        </TransitionChild>

        <div className="fixed inset-0">
          <div className="flex min-h-full flex-col items-center justify-center pt-[56px]">
            <TransitionChild>
              <DialogPanel className={cn(
                'relative h-[calc(100vh-56px)] w-full grow overflow-hidden rounded-t-xl bg-white p-0 text-left align-middle shadow-xl transition-all',
                'data-[closed]:scale-95  data-[closed]:opacity-0',
                'data-[enter]:scale-100 data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
                'data-[enter]:scale-95 data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
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
