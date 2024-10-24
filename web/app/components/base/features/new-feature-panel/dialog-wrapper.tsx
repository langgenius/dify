import { Fragment, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Dialog, Transition } from '@headlessui/react'
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
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0">
          <div className={cn('flex flex-col items-end justify-center min-h-full pb-2', inWorkflow ? 'pt-[112px]' : 'pt-[64px] pr-2')}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className={cn('grow flex flex-col relative w-[420px] h-0 p-0 overflow-hidden text-left align-middle transition-all transform bg-components-panel-bg-alt border-components-panel-border shadow-xl', inWorkflow ? 'border-t-[0.5px] border-l-[0.5px] border-b-[0.5px] rounded-l-2xl' : 'border-[0.5px] rounded-2xl', className)}>
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default DialogWrapper
