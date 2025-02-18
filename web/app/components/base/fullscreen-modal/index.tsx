import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { RiCloseLargeLine } from '@remixicon/react'
import classNames from '@/utils/classnames'

type IModal = {
  className?: string
  wrapperClassName?: string
  open: boolean
  onClose?: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  closable?: boolean
  overflowVisible?: boolean
}

export default function FullScreenModal({
  className,
  wrapperClassName,
  open,
  onClose = () => { },
  children,
  closable = false,
  overflowVisible = false,
}: IModal) {
  return (
    <Transition show={open} as={Fragment}>
      <Dialog as="div" className={classNames('modal-dialog', wrapperClassName)} onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-background-overlay-backdrop backdrop-blur-[6px]" />
        </Transition.Child>

        <div
          className="fixed inset-0 h-screen w-screen p-4"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="w-full h-full bg-background-default-subtle rounded-2xl border border-effects-highlight relative">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className={classNames(
                'h-full',
                overflowVisible ? 'overflow-visible' : 'overflow-hidden',
                className,
              )}>
                {closable
                  && <div
                    className='absolute z-50 top-3 right-3 w-9 h-9 flex items-center justify-center rounded-[10px]
                  bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover cursor-pointer'
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose()
                    }}>
                    <RiCloseLargeLine className='w-3.5 h-3.5 text-components-button-tertiary-text' />
                  </div>}
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
