import { Dialog, DialogPanel, Transition } from '@headlessui/react'
import { RiCloseLargeLine } from '@remixicon/react'
import classNames from '@/utils/classnames'
import { useEffect, useState } from 'react'

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
  const [showTransition, setShowTransition] = useState(false)
  useEffect(() => {
    if (!open) {
      setShowTransition(false)
      return
    }
    setTimeout(() => {
      setShowTransition(true)
    }, 100)
  }, [open])
  return (
    <Dialog as="div" className={classNames('modal-dialog', wrapperClassName)} onClose={onClose} open={open}>
      <Transition show={showTransition}>
        <div className={classNames(
          'fixed inset-0 bg-background-overlay-backdrop backdrop-blur-[6px] transition',
          'data-[closed]:opacity-0',
          'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100',
          'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0',
        )} />
      </Transition>

      <div
        className="fixed inset-0 h-screen w-screen p-4"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div className="w-full h-full bg-background-default-subtle rounded-2xl border border-effects-highlight relative">
          <Transition show={showTransition}>
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
                  className='absolute z-50 top-3 right-3 w-9 h-9 flex items-center justify-center rounded-[10px]
                  bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover cursor-pointer'
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose()
                  }}>
                  <RiCloseLargeLine className='w-3.5 h-3.5 text-components-button-tertiary-text' />
                </div>}
              {children}
            </DialogPanel>
          </Transition>
        </div>
      </div>
    </Dialog>
  )
}
