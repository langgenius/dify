import { Fragment, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const AccessControlDialog = ({
  className,
  children,
  show,
  onClose,
}: DialogProps) => {
  const close = useCallback(() => {
    onClose?.()
  }, [onClose])
  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" open={true} className="relative z-[99]" onClose={() => null}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-background-overlay" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className={cn('relative h-auto min-h-[323px] w-[600px] overflow-y-auto rounded-2xl bg-components-panel-bg p-0 shadow-xl transition-all', className)}>
              <div onClick={() => close()} className="absolute right-5 top-5 z-10 flex h-8 w-8 cursor-pointer items-center justify-center">
                <RiCloseLine className='h-5 w-5 text-text-tertiary' />
              </div>
              {children}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition >
  )
}

export default AccessControlDialog
