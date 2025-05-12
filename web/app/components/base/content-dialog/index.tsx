import type { ReactNode } from 'react'
import { Transition, TransitionChild } from '@headlessui/react'
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
      className="absolute left-0 top-0 z-20 box-border h-full w-full p-2"
    >
      <TransitionChild>
        <div
          className={classNames(
            'absolute left-0 inset-0 w-full bg-app-detail-overlay-bg',
            'duration-300 ease-in data-[closed]:opacity-0',
            'data-[enter]:opacity-100',
            'data-[leave]:opacity-0',
          )}
          onClick={onClose}
        />
      </TransitionChild>

      <TransitionChild>
        <div className={classNames(
          'absolute left-0 w-full bg-app-detail-bg border-r border-divider-burn',
          'duration-100 ease-in data-[closed]:-translate-x-full',
          'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:translate-x-0',
          'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:-translate-x-full',
          className,
        )}>
          {children}
        </div>
      </TransitionChild>
    </Transition>
  )
}

export default ContentDialog
