import { Fragment, useCallback } from 'react'
import type { ElementType, ReactNode } from 'react'
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react'
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
        <TransitionChild>
          <div className={classNames(
            'fixed inset-0 bg-black bg-opacity-25',
            'data-[closed]:opacity-0',
            'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100',
            'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0',
          )} />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center">
            <TransitionChild>
              <DialogPanel className={classNames(
                'w-full max-w-[800px] p-6 overflow-hidden transition-all transform bg-components-panel-bg border-[0.5px] border-components-panel-border shadow-xl rounded-2xl',
                'data-[closed]:opacity-0  data-[closed]:scale-95',
                'data-[enter]:ease-out data-[enter]:duration-300 data-[enter]:opacity-100 data-[enter]:scale-100',
                'data-[leave]:ease-in data-[leave]:duration-200 data-[leave]:opacity-0 data-[enter]:scale-95',
                className,
              )}>
                {Boolean(title) && (
                  <DialogTitle
                    as={titleAs || 'h3'}
                    className={classNames('pr-8 pb-3 title-2xl-semi-bold text-text-primary', titleClassName)}
                  >
                    {title}
                  </DialogTitle>
                )}
                <div className={classNames(bodyClassName)}>
                  {children}
                </div>
                {Boolean(footer) && (
                  <div className={classNames('flex items-center justify-end gap-2 px-6 pb-6 pt-3', footerClassName)}>
                    {footer}
                  </div>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition >
  )
}

export default CustomDialog
