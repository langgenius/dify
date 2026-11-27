'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { systemModelDialog } from './handle'

type SystemModelTriggerProps = {
  className?: string
  notConfigured: boolean
  isLoading?: boolean
}

export function SystemModelTrigger({
  className,
  notConfigured,
  isLoading,
}: SystemModelTriggerProps) {
  const { t } = useTranslation(['modelProvider'])

  return (
    <DialogTrigger
      handle={systemModelDialog}
      render={<Button variant={notConfigured ? 'primary' : 'secondary'} size="small" />}
      className={cn('relative', className)}
      disabled={isLoading}
    >
      {isLoading ? (
        <span className="i-ri-loader-2-line size-3.5 animate-spin" />
      ) : (
        <span className="i-ri-brain-2-line size-3.5" />
      )}
      {t(($) => $['modelProvider.systemModelSettings'], { ns: 'modelProvider' })}
    </DialogTrigger>
  )
}
