import { Fragment, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import cn from '@/utils/classnames'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const MenuDialog = ({
  className,
  children,
  show,
  onClose,
}: DialogProps) => {
  const close = useCallback(() => onClose?.(), [onClose])
  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={close}>
        <div className="fixed inset-0">
          <div className="flex flex-col items-center justify-center min-h-full">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className={cn('grow relative w-full h-full p-0 overflow-hidden text-left align-middle transition-all transform bg-background-sidenav-bg backdrop-blur-md', className)}>
                <div className='absolute right-0 top-0 h-full w-1/2 bg-components-panel-bg'/>
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default MenuDialog
