'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { openDeployDrawerAtom } from '../../../deploy-drawer/state'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import {
  deploymentEnvironmentDeploymentsIsErrorAtom,
  deploymentEnvironmentDeploymentsIsLoadingAtom,
  deploymentRuntimeInstanceRowsAtom,
} from '../../state'

export function NewDeploymentButton() {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)

  return (
    <Button
      size="medium"
      variant="primary"
      className="gap-1.5"
      disabled={!appInstanceId}
      onClick={() => {
        if (!appInstanceId)
          return
        openDeployDrawer({ appInstanceId })
      }}
    >
      <span className="i-ri-rocket-line size-4 shrink-0" aria-hidden="true" />
      {t('deployTab.newDeployment')}
    </Button>
  )
}

export function NewDeploymentHeaderAction() {
  const isLoading = useAtomValue(deploymentEnvironmentDeploymentsIsLoadingAtom)
  const hasError = useAtomValue(deploymentEnvironmentDeploymentsIsErrorAtom)
  const rows = useAtomValue(deploymentRuntimeInstanceRowsAtom)

  if (isLoading || hasError || rows.length === 0)
    return null

  return <NewDeploymentButton />
}
