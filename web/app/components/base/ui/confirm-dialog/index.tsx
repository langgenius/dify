'use client'

import * as React from 'react'
import { useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'

export type IConfirm = {
  className?: string
  isShow: boolean
  type?: 'info' | 'warning' | 'danger'
  title: string
  content?: React.ReactNode
  confirmText?: string | null
  onConfirm: () => void
  cancelText?: string
  onCancel: () => void
  isLoading?: boolean
  isDisabled?: boolean
  showConfirm?: boolean
  showCancel?: boolean
  maskClosable?: boolean
  confirmInputLabel?: string
  confirmInputPlaceholder?: string
  confirmInputValue?: string
  onConfirmInputChange?: (value: string) => void
  confirmInputMatchValue?: string
}

function Confirm({
  className,
  isShow,
  type = 'warning',
  title,
  content,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  showConfirm = true,
  showCancel = true,
  isLoading = false,
  isDisabled = false,
  maskClosable = true,
  confirmInputLabel,
  confirmInputPlaceholder,
  confirmInputValue = '',
  onConfirmInputChange,
  confirmInputMatchValue,
}: IConfirm) {
  const { t } = useTranslation()
  const confirmInputId = useId()

  const confirmTxt = confirmText || t('operation.confirm', { ns: 'common' })
  const cancelTxt = cancelText || t('operation.cancel', { ns: 'common' })
  const isConfirmDisabled = isDisabled || (confirmInputMatchValue ? confirmInputValue !== confirmInputMatchValue : false)

  useEffect(() => {
    if (!isShow)
      return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !isConfirmDisabled) {
        event.preventDefault()
        onConfirm()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isConfirmDisabled, isShow, onConfirm])

  return (
    <AlertDialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <AlertDialogContent
        className={className}
        overlayClassName="confirm-dialog-overlay"
        backdropProps={{
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
          },
          onMouseDown: () => {
            if (maskClosable)
              onCancel()
          },
        }}
      >
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle title={title} className="w-full truncate title-2xl-semi-bold text-text-primary">
            {title}
          </AlertDialogTitle>
          {content !== undefined && content !== null && (
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {content}
            </AlertDialogDescription>
          )}
          {confirmInputLabel && (
            <div className="mt-2">
              <label htmlFor={confirmInputId} className="mb-2 block system-sm-regular text-text-secondary">
                {confirmInputLabel}
              </label>
              <Input
                id={confirmInputId}
                value={confirmInputValue}
                placeholder={confirmInputPlaceholder}
                onChange={event => onConfirmInputChange?.(event.target.value)}
              />
            </div>
          )}
        </div>
        {(showCancel || showConfirm) && (
          <AlertDialogActions>
            {showCancel && (
              <AlertDialogCancelButton>
                {cancelTxt}
              </AlertDialogCancelButton>
            )}
            {showConfirm && (
              <AlertDialogConfirmButton
                variant="primary"
                destructive={type !== 'info'}
                loading={isLoading}
                disabled={isConfirmDisabled}
                onClick={onConfirm}
              >
                {confirmTxt}
              </AlertDialogConfirmButton>
            )}
          </AlertDialogActions>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default React.memo(Confirm)
