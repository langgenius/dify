'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import {
  createReleaseAppInstanceIdAtom,
  createReleaseLocalAtoms,
} from './state'
import { CreateReleaseDialog } from './ui/dialog'

function CreateReleaseTrigger({
  variant,
  size,
  label,
  className,
}: {
  variant: ButtonProps['variant']
  size: ButtonProps['size']
  label?: string
  className?: string
}) {
  const { t } = useTranslation('deployments')

  return (
    <DialogTrigger
      render={(
        <Button
          size={size}
          variant={variant}
          className={className}
        />
      )}
    >
      {label ?? t('versions.createRelease')}
    </DialogTrigger>
  )
}

export function CreateReleaseControl({
  appInstanceId,
  variant = 'primary',
  size = 'small',
  label,
  className,
}: {
  appInstanceId: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  label?: string
  className?: string
}) {
  return (
    <ScopeProvider
      key={appInstanceId}
      atoms={[
        [createReleaseAppInstanceIdAtom, appInstanceId],
        ...createReleaseLocalAtoms,
      ]}
      name="CreateRelease"
    >
      <CreateReleaseDialog>
        <CreateReleaseTrigger
          variant={variant}
          size={size}
          label={label}
          className={className}
        />
      </CreateReleaseDialog>
    </ScopeProvider>
  )
}
