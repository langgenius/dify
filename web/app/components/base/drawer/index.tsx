'use client'
import { Dialog, DialogBackdrop, DialogTitle } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import { XMarkIcon } from '@heroicons/react/24/outline'
import Button from '../button'
import cn from '@/utils/classnames'

export type IDrawerProps = {
  title?: string
  description?: string
  dialogClassName?: string
  dialogBackdropClassName?: string
  panelClassName?: string
  children: React.ReactNode
  footer?: React.ReactNode
  mask?: boolean
  positionCenter?: boolean
  isOpen: boolean
  showClose?: boolean
  clickOutsideNotOpen?: boolean
  onClose: () => void
  onCancel?: () => void
  onOk?: () => void
  unmount?: boolean
}

export default function Drawer({
  title = '',
  description = '',
  dialogClassName = '',
  dialogBackdropClassName = '',
  panelClassName = '',
  children,
  footer,
  mask = true,
  positionCenter,
  showClose = false,
  isOpen,
  clickOutsideNotOpen,
  onClose,
  onCancel,
  onOk,
  unmount = false,
}: IDrawerProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      unmount={unmount}
      open={isOpen}
      onClose={() => {
        if (!clickOutsideNotOpen)
          onClose()
      }}
      className={cn('fixed inset-0 z-[30] overflow-y-auto', dialogClassName)}
    >
      <div className={cn('flex h-screen w-screen justify-end', positionCenter && '!justify-center')}>
        {/* mask */}
        <DialogBackdrop
          className={cn('fixed inset-0 z-[40]', mask && 'bg-black/30', dialogBackdropClassName)}
          onClick={() => {
            if (!clickOutsideNotOpen)
              onClose()
          }}
        />
        <div className={cn('relative z-[50] flex w-full max-w-sm flex-col justify-between overflow-hidden bg-components-panel-bg p-6 text-left align-middle shadow-xl', panelClassName)}>
          <>
            <div className='flex justify-between'>
              {title && <DialogTitle
                as="h3"
                className="text-lg font-medium leading-6 text-text-primary"
              >
                {title}
              </DialogTitle>}
              {showClose && <DialogTitle className="mb-4 flex cursor-pointer items-center" as="div">
                <XMarkIcon className='h-4 w-4 text-text-tertiary' onClick={onClose} />
              </DialogTitle>}
            </div>
            {description && <div className='mt-2 text-xs font-normal text-text-tertiary'>{description}</div>}
            {children}
          </>
          {footer || (footer === null
            ? null
            : <div className="mt-10 flex flex-row justify-end">
              <Button
                className='mr-2'
                onClick={() => {
                  onCancel?.()
                }}>{t('common.operation.cancel')}</Button>
              <Button
                onClick={() => {
                  onOk?.()
                }}>{t('common.operation.save')}</Button>
            </div>)}
        </div>
      </div>
    </Dialog>
  )
}
