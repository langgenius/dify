import type { ReactNode } from 'react'
import { Transition, TransitionChild } from '@headlessui/react'
import { cn } from '@/utils/classnames'

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
      className="absolute left-0 top-0 z-30 box-border h-full w-full p-2"
    >
      <TransitionChild>
        <div
          className={cn('absolute inset-0 left-0 w-full bg-app-detail-overlay-bg', 'duration-300 ease-in data-[closed]:opacity-0', 'data-[enter]:opacity-100', 'data-[leave]:opacity-0')}
          onClick={onClose}
        />
      </TransitionChild>

      <TransitionChild>
        <div className={cn('absolute left-0 w-full border-r border-divider-burn bg-app-detail-bg', 'duration-100 ease-in data-[closed]:-translate-x-full', 'data-[enter]:translate-x-0 data-[enter]:duration-300 data-[enter]:ease-out', 'data-[leave]:-translate-x-full data-[leave]:duration-200 data-[leave]:ease-in', className)}>
          {children}
        </div>
      </TransitionChild>
    </Transition>
  )
}

export default ContentDialog
