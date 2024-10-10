import { Fragment, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { RiCloseLine } from '@remixicon/react'
import { Dialog, Transition } from '@headlessui/react'
import Button from '@/app/components/base/button'
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
      <Dialog as="div" className="relative z-40" onClose={() => {}}>
        <div className="fixed inset-0">
          <div className="flex flex-col items-center justify-center min-h-full">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className={cn('grow relative w-full h-full p-0 overflow-hidden text-left align-middle transition-all transform bg-background-sidenav-bg backdrop-blur-md', className)}>
                <div className='absolute right-0 top-0 h-full w-1/2 bg-components-panel-bg'/>
                <div className='absolute top-6 right-6 flex flex-col items-center'>
                  <Button
                    variant='tertiary'
                    size='large'
                    className='px-2'
                    onClick={close}
                  >
                    <RiCloseLine className='w-5 h-5' />
                  </Button>
                  <div className='mt-1 text-text-tertiary system-2xs-medium-uppercase'>ESC</div>
                </div>
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default MenuDialog
