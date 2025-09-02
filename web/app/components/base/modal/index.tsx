import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react'
import { Fragment } from 'react'
import { RiCloseLine } from '@remixicon/react'
import classNames from '@/utils/classnames'
import { noop } from 'lodash-es'
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
  highPriority?: boolean // For modals that need to appear above dropdowns
}

export default function Modal({
  className,
  wrapperClassName,
  isShow,
  onClose = noop,
  title,
  description,
  children,
  closable = false,
  overflowVisible = false,
  highPriority = false,
}: IModal) {
  return (
    <Transition appear show={isShow} as={Fragment}>
      <Dialog as="div" className={classNames('relative', highPriority ? 'z-[1100]' : 'z-[60]', wrapperClassName)} onClose={onClose}>
        <TransitionChild>
          <div className={classNames(
            'fixed inset-0 bg-background-overlay',
            'duration-300 ease-in data-[closed]:opacity-0',
            'data-[enter]:opacity-100',
            'data-[leave]:opacity-0',
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
                'relative w-full max-w-[480px] rounded-2xl bg-components-panel-bg p-6 text-left align-middle shadow-xl transition-all',
                overflowVisible ? 'overflow-visible' : 'overflow-hidden',
                'duration-100 ease-in data-[closed]:scale-95 data-[closed]:opacity-0',
                'data-[enter]:scale-100 data-[enter]:opacity-100',
                'data-[enter]:scale-95 data-[leave]:opacity-0',
                className,
              )}>
                {title && <DialogTitle
                  as="h3"
                  className="title-2xl-semi-bold text-text-primary"
                >
                  {title}
                </DialogTitle>}
                {description && <div className='body-md-regular mt-2 text-text-secondary'>
                  {description}
                </div>}
                {closable
                  && <div className='absolute right-6 top-6 z-10 flex h-5 w-5 items-center justify-center rounded-2xl hover:cursor-pointer hover:bg-state-base-hover'>
                    <RiCloseLine className='h-4 w-4 text-text-tertiary' onClick={
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
