import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react'
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
      <Dialog as="div" className={classNames('relative z-[60]', wrapperClassName)} onClose={onClose}>
        <TransitionChild>
          <div className={classNames(
            'fixed inset-0 bg-background-overlay',
            'data-[closed]:opacity-0',
            'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100',
            'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0',
          )} />
        </TransitionChild>

        <div
          className="fixed inset-0 overflow-y-auto"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild>
              <DialogPanel className={classNames(
                'w-full max-w-[480px] transform rounded-2xl bg-components-panel-bg p-6 text-left align-middle shadow-xl transition-all',
                overflowVisible ? 'overflow-visible' : 'overflow-hidden',
                'data-[closed]:opacity-0',
                'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100',
                'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0',
                className,
              )}>
                {title && <DialogTitle
                  as="h3"
                  className="title-2xl-semi-bold text-text-primary"
                >
                  {title}
                </DialogTitle>}
                {description && <div className='text-text-secondary body-md-regular mt-2'>
                  {description}
                </div>}
                {closable
                  && <div className='hover:bg-state-base-hover absolute right-6 top-6 z-10 flex h-5 w-5 items-center justify-center rounded-2xl hover:cursor-pointer'>
                    <RiCloseLine className='text-text-tertiary h-4 w-4' onClick={
                      (e) => {
                        e.stopPropagation()
                        onClose()
                      }
                    } />
                  </div>}
                {children}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
