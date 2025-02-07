import { Fragment, type ReactNode } from 'react'
import { Transition } from '@headlessui/react'
import classNames from '@/utils/classnames'

type ContentDialogProps = {
  className?: string
  show: boolean
  onClose?: () => void
  children: ReactNode
}

const ContentDialog = ({
  className,
  show,
  onClose,
  children,
}: ContentDialogProps) => {
  return (
    <Transition
      show={show}
      as="div"
      className="absolute left-0 top-0 w-full h-full z-20 p-2 box-border"
    >
      <Transition.Child
        as={Fragment}
        enter="ease-out duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="ease-in duration-200"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <div
          className="absolute left-0 inset-0 w-full bg-app-detail-overlay-bg"
          onClick={onClose}
        />
      </Transition.Child>

      <Transition.Child
        as={Fragment}
        enter="transform transition ease-out duration-300"
        enterFrom="-translate-x-full"
        enterTo="translate-x-0"
        leave="transform transition ease-in duration-200"
        leaveFrom="translate-x-0"
        leaveTo="-translate-x-full"
      >
        <div className={classNames(
          'absolute left-0 w-full bg-app-detail-bg border-r border-divider-burn',
          className,
        )}>
          {children}
        </div>
      </Transition.Child>
    </Transition>
  )
}

export default ContentDialog
