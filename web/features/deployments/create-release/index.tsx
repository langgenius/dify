'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import {
  createReleaseConfigAtom,
  createReleaseLocalAtoms,
  openCreateReleaseDialogAtom,
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
  const openDialog = useSetAtom(openCreateReleaseDialogAtom)

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={openDialog}
    >
      {label ?? t('versions.createRelease')}
    </Button>
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
        [createReleaseConfigAtom, { appInstanceId }],
        ...createReleaseLocalAtoms,
      ]}
      name="CreateRelease"
    >
      <CreateReleaseTrigger
        variant={variant}
        size={size}
        label={label}
        className={className}
      />
      <CreateReleaseDialog />
    </ScopeProvider>
  )
}
