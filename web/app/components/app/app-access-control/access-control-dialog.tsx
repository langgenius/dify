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
  const close = useCallback(() => onClose?.(), [onClose])
  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" open={true} className="relative z-40" onClose={close}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-background-overlay bg-opacity-25" />
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
            <Dialog.Panel className={cn('w-[600px] min-h-[323px] h-auto bg-components-panel-bg shadow-xl rounded-2xl transition-all transform relative p-0 overflow-y-auto', className)}>
              <div onClick={close} className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center cursor-pointer z-10">
                <RiCloseLine className='w-5 h-5' />
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
