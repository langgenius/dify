'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { cn } from '@/utils/classnames'

export type InlineDeleteConfirmProps = {
  title?: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  className?: string
  variant?: 'delete' | 'warning' | 'info'
}

const InlineDeleteConfirm: FC<InlineDeleteConfirmProps> = ({
  title,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  className,
  variant = 'delete',
}) => {
  const { t } = useTranslation()

  const titleText = title || t('operation.deleteConfirmTitle', { ns: 'common', defaultValue: 'Delete?' })
  const confirmTxt = confirmText || t('operation.yes', { ns: 'common', defaultValue: 'Yes' })
  const cancelTxt = cancelText || t('operation.no', { ns: 'common', defaultValue: 'No' })

  return (
    <div
      aria-labelledby="inline-delete-confirm-title"
      aria-describedby="inline-delete-confirm-description"
      className={cn(
        'flex w-[120px] flex-col justify-center gap-1.5',
        'rounded-[10px] border-[0.5px] border-components-panel-border-subtle',
        'bg-components-panel-bg-blur px-2 pb-2 pt-1.5',
        'backdrop-blur-[10px]',
        'shadow-lg',
        className,
      )}
    >
      <div
        id="inline-delete-confirm-title"
        className="system-xs-semibold text-text-primary"
      >
        {titleText}
      </div>

      <div className="flex w-full items-center justify-center gap-1">
        <Button
          size="small"
          variant="secondary"
          onClick={onCancel}
          aria-label={cancelTxt}
          className="flex-1"
        >
          {cancelTxt}
        </Button>
        <Button
          size="small"
          variant="primary"
          destructive={variant === 'delete'}
          onClick={onConfirm}
          aria-label={confirmTxt}
          className="flex-1"
        >
          {confirmTxt}
        </Button>
      </div>

      <span id="inline-delete-confirm-description" className="sr-only">
        {t('operation.confirmAction', { ns: 'common', defaultValue: 'Please confirm your action.' })}
      </span>
    </div>
  )
}

InlineDeleteConfirm.displayName = 'InlineDeleteConfirm'

export default InlineDeleteConfirm
