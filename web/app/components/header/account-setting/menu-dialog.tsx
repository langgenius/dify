import { Fragment, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Dialog, DialogPanel, Transition } from '@headlessui/react'
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
          <div className="flex min-h-full flex-col items-center justify-center">
            <DialogPanel className={cn(
              'bg-background-sidenav-bg relative h-full w-full grow overflow-hidden p-0 text-left align-middle backdrop-blur-md transition-all',
              'data-[closed]:scale-95  data-[closed]:opacity-0',
              'data-[enter]:scale-100 data-[enter]:opacity-100 data-[enter]:duration-300 data-[enter]:ease-out',
              'data-[enter]:scale-95 data-[leave]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in',
              className,
            )}>
              <div className='bg-components-panel-bg absolute right-0 top-0 h-full w-1/2' />
              {children}
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default MenuDialog
