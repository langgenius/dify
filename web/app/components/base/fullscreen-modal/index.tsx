import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
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
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className={classNames('modal-dialog', wrapperClassName)} onClose={onClose} open={open}>
        <TransitionChild>
          <div className={classNames(
            'fixed inset-0 bg-background-overlay-backdrop backdrop-blur-[6px] transition',
            'data-[closed]:opacity-0',
            'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100',
            'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0',
          )} />
        </TransitionChild>

        <div
          className="fixed inset-0 h-screen w-screen p-4"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="bg-background-default-subtle border-effects-highlight relative h-full w-full rounded-2xl border">
            <TransitionChild>
              <DialogPanel className={classNames(
                'h-full transition',
                overflowVisible ? 'overflow-visible' : 'overflow-hidden',
                'data-[closed]:opacity-0',
                'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100',
                'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0',
                className,
              )}>
                {closable
                  && <div
                    className='bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover absolute right-3 top-3 z-50 flex h-9 w-9 cursor-pointer
                  items-center justify-center rounded-[10px]'
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose()
                    }}>
                    <RiCloseLargeLine className='text-components-button-tertiary-text h-3.5 w-3.5' />
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
