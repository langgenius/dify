import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { RiCloseLine } from '@remixicon/react'
import classNames from '@/utils/classnames'
// https://headlessui.com/react/dialog

type IModal = {
  className?: string
  wrapperClassName?: string
  isShow: boolean
  onClose?: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  closable?: boolean
  overflowVisible?: boolean
}

export default function Modal({
  className,
  wrapperClassName,
  isShow,
  onClose = () => { },
  title,
  description,
  children,
  closable = false,
  overflowVisible = false,
}: IModal) {
  return (
    <Transition appear show={isShow} as={Fragment}>
      <Dialog as="div" className={classNames('relative z-50', wrapperClassName)} onClose={onClose}>
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

        <div
          className="fixed inset-0 overflow-y-auto"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="flex min-h-full items-center justify-center p-4 text-center">
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
                'w-full max-w-[480px] transform rounded-2xl bg-components-panel-bg p-6 text-left align-middle shadow-xl transition-all',
                overflowVisible ? 'overflow-visible' : 'overflow-hidden',
                className,
              )}>
                {title && <Dialog.Title
                  as="h3"
                  className="title-2xl-semi-bold text-text-primary"
                >
                  {title}
                </Dialog.Title>}
                {description && <Dialog.Description className='text-text-secondary body-md-regular mt-2'>
                  {description}
                </Dialog.Description>}
                {closable
                  && <div className='absolute z-10 top-6 right-6 w-5 h-5 rounded-2xl flex items-center justify-center hover:cursor-pointer hover:bg-state-base-hover'>
                    <RiCloseLine className='w-4 h-4 text-text-tertiary' onClick={
                      (e) => {
                        e.stopPropagation()
                        onClose()
                      }
                    } />
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
