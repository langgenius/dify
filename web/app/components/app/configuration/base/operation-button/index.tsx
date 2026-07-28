'use client'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type OperationButtonProps = Omit<ButtonProps, 'children' | 'size' | 'variant'> & {
  operation: 'add' | 'edit'
  actionName?: string
}

export function OperationButton({
  operation,
  actionName,
  className,
  ...buttonProps
}: OperationButtonProps) {
  const { t } = useTranslation()
  return (
    <Button
      {...buttonProps}
      variant="ghost"
      size="small"
      className={cn('h-7 gap-1 px-3 text-text-secondary', className)}
    >
      <span
        aria-hidden
        className={cn('size-3.5', operation === 'add' ? 'i-ri-add-line' : 'i-ri-edit-line')}
      />
      <span className="text-xs font-medium">
        {actionName || t(($) => $[`operation.${operation}`], { ns: 'common' })}
      </span>
    </Button>
  )
}
