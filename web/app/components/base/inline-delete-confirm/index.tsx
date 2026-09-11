'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

type InlineDeleteConfirmProps = {
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
  const titleId = useId()
  const descriptionId = useId()

  const titleText =
    title || t(($) => $['operation.deleteConfirmTitle'], { ns: 'common', defaultValue: 'Delete?' })
  const confirmTxt =
    confirmText || t(($) => $['operation.yes'], { ns: 'common', defaultValue: 'Yes' })
  const cancelTxt = cancelText || t(($) => $['operation.no'], { ns: 'common', defaultValue: 'No' })

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        'flex w-30 flex-col justify-center gap-1.5',
        'rounded-[10px] border-[0.5px] border-components-panel-border-subtle',
        'bg-components-panel-bg-blur px-2 pt-1.5 pb-2',
        'backdrop-blur-[10px]',
        'shadow-lg',
        className,
      )}
    >
      <div id={titleId} className="system-xs-semibold text-text-primary">
        {titleText}
      </div>

      <div className="flex w-full items-center justify-center gap-1">
        <Button size="small" variant="secondary" onClick={onCancel} className="flex-1">
          {cancelTxt}
        </Button>
        <Button
          size="small"
          variant="primary"
          tone={variant === 'delete' ? 'destructive' : 'default'}
          onClick={onConfirm}
          className="flex-1"
        >
          {confirmTxt}
        </Button>
      </div>

      <span id={descriptionId} className="sr-only">
        {t(($) => $['operation.confirmAction'], {
          ns: 'common',
          defaultValue: 'Please confirm your action.',
        })}
      </span>
    </div>
  )
}

InlineDeleteConfirm.displayName = 'InlineDeleteConfirm'

export default InlineDeleteConfirm
