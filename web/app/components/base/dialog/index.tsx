import { Fragment, useCallback } from 'react'
import type { ElementType, ReactNode } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import classNames from '@/utils/classnames'

// https://headlessui.com/react/dialog

type DialogProps = {
  className?: string
  titleClassName?: string
  bodyClassName?: string
  footerClassName?: string
  titleAs?: ElementType
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  show: boolean
  onClose?: () => void
}

const CustomDialog = ({
  className,
  titleClassName,
  bodyClassName,
  footerClassName,
  titleAs,
  title,
  children,
  footer,
  show,
  onClose,
}: DialogProps) => {
  const close = useCallback(() => onClose?.(), [onClose])
  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={close}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex items-center justify-center min-h-full p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className={classNames('w-full max-w-[800px] p-0 overflow-hidden text-left text-gray-900 align-middle transition-all transform bg-white shadow-xl rounded-2xl', className)}>
                {Boolean(title) && (
                  <Dialog.Title
                    as={titleAs || 'h3'}
                    className={classNames('px-8 py-6 text-lg font-medium leading-6 text-gray-900', titleClassName)}
                  >
                    {title}
                  </Dialog.Title>
                )}
                <div className={classNames('px-8 text-lg font-medium leading-6', bodyClassName)}>
                  {children}
                </div>
                {Boolean(footer) && (
                  <div className={classNames('flex items-center justify-end gap-2 px-8 py-6', footerClassName)}>
                    {footer}
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default CustomDialog
