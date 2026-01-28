import type { ReactNode } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { noop } from 'es-toolkit/function'
import { Fragment, useCallback, useEffect } from 'react'
import { cn } from '@/utils/classnames'

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [close])

  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" className="relative z-[60]" onClose={noop}>
        <div className="fixed inset-0">
          <div className="flex min-h-full flex-col items-center justify-center">
            <TransitionChild>
              <DialogPanel className={cn(
                'relative h-full w-full grow overflow-hidden bg-background-sidenav-bg p-0 text-left align-middle backdrop-blur-md transition-all',
                'duration-300 ease-in data-[closed]:scale-95 data-[closed]:opacity-0',
                'data-[enter]:scale-100 data-[enter]:opacity-100',
                'data-[enter]:scale-95 data-[leave]:opacity-0',
                className,
              )}
              >
                <div className="absolute right-0 top-0 h-full w-1/2 bg-components-panel-bg" />
                {children}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

export default MenuDialog
