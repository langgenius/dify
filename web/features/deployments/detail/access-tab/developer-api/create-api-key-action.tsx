'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { CreateApiKeyDialog } from './create-api-key-dialog'

export function CreateApiKeyAction({
  environments,
  onCreatedToken,
  triggerVariant = 'secondary',
  triggerClassName,
  children,
}: {
  environments: Environment[]
  onCreatedToken: (token: string) => void
  triggerVariant?: ButtonProps['variant']
  triggerClassName?: string
  children?: (props: { trigger: ReactNode }) => ReactNode
}) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDialogSessionKey, setCreateDialogSessionKey] = useState(0)
  const disabled = !appInstanceId || environments.length === 0

  function handleOpenCreateDialog() {
    const firstEnvironment = environments[0]
    if (!firstEnvironment)
      return

    setCreateDialogSessionKey(sessionKey => sessionKey + 1)
    setCreateDialogOpen(true)
  }

  const trigger = (
    <Button
      type="button"
      variant={triggerVariant}
      disabled={disabled}
      onClick={handleOpenCreateDialog}
      className={cn('gap-1.5', triggerClassName)}
    >
      <span className="i-ri-add-line size-4" aria-hidden="true" />
      {t('access.api.newKey')}
    </Button>
  )

  return (
    <>
      {children ? children({ trigger }) : trigger}
      <CreateApiKeyDialog
        appInstanceId={appInstanceId}
        environments={environments}
        open={createDialogOpen}
        sessionKey={createDialogSessionKey}
        onCreatedToken={onCreatedToken}
        onOpenChange={setCreateDialogOpen}
      />
    </>
  )
}
