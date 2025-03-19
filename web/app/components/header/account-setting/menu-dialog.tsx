import { Fragment, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        close()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [close])

  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" className="relative z-[60]" onClose={() => { }}>
        <div className="fixed inset-0">
          <div className="flex flex-col items-center justify-center min-h-full">
            <TransitionChild>
              <DialogPanel className={cn(
                'grow relative w-full h-full p-0 overflow-hidden text-left align-middle transition-all transform bg-background-sidenav-bg backdrop-blur-md',
                'data-[closed]:opacity-0  data-[closed]:scale-95',
                'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100 data-[enter]:scale-100',
                'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0 data-[enter]:scale-95',
                className,
              )}>
                <div className='absolute top-0 right-0 h-full w-1/2 bg-components-panel-bg' />
                {children}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default MenuDialog
