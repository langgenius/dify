'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

type ConfigureSectionAddButtonProps = Omit<ButtonProps, 'aria-label' | 'children' | 'size' | 'variant'> & {
  ariaLabel: string
}

export function ConfigureSectionAddButton({
  ariaLabel,
  className,
  ...props
}: ConfigureSectionAddButtonProps) {
  const { t } = useTranslation('common')
  const readOnly = useAgentOrchestrateReadOnly()

  if (readOnly)
    return null

  return (
    <Button
      {...props}
      aria-label={ariaLabel}
      variant="ghost"
      size="small"
      className={cn('shrink-0 gap-1 px-2', className)}
    >
      <span aria-hidden className="i-ri-add-line size-3.5" />
      <span>{t('operation.add')}</span>
    </Button>
  )
}
