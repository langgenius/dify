import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { RiCloseLargeLine } from '@remixicon/react'
import classNames from '@/utils/classnames'
import { noop } from 'lodash-es'

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
  onClose = noop,
  children,
  closable = false,
  overflowVisible = false,
}: IModal) {
  return (
    <Transition show={open} appear>
      <Dialog as="div" className={classNames('modal-dialog', wrapperClassName)} onClose={onClose}>
        <TransitionChild>
          <div className={classNames(
            'fixed inset-0 bg-background-overlay-backdrop backdrop-blur-[6px]',
            'duration-300 ease-in data-[closed]:opacity-0',
            'data-[enter]:opacity-100',
            'data-[leave]:opacity-0',
          )} />
        </TransitionChild>

        <div
          className="fixed inset-0 h-screen w-screen p-4"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="relative h-full w-full rounded-2xl border border-effects-highlight bg-background-default-subtle">
            <TransitionChild>
              <DialogPanel className={classNames(
                'h-full',
                overflowVisible ? 'overflow-visible' : 'overflow-hidden',
                'duration-100 ease-in data-[closed]:scale-95 data-[closed]:opacity-0',
                'data-[enter]:scale-100 data-[enter]:opacity-100',
                'data-[enter]:scale-95 data-[leave]:opacity-0',
                className,
              )}>
                {closable
                  && <div
                    className='absolute right-3 top-3 z-50 flex h-9 w-9 cursor-pointer items-center justify-center
                  rounded-[10px] bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover'
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose()
                    }}>
                    <RiCloseLargeLine className='h-3.5 w-3.5 text-components-button-tertiary-text' />
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
