'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export function CreateApiKeyButton({
  disabled,
  triggerVariant = 'secondary',
  triggerClassName,
  onClick,
}: {
  disabled?: boolean
  triggerVariant?: ButtonProps['variant']
  triggerClassName?: string
  onClick: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <Button
      type="button"
      variant={triggerVariant}
      disabled={disabled}
      onClick={onClick}
      className={cn('gap-1.5', triggerClassName)}
    >
      <span className="i-ri-add-line size-4" aria-hidden="true" />
      {t('access.api.newKey')}
    </Button>
  )
}
