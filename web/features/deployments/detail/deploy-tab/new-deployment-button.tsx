'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { openDeployDrawerAtom } from '../../deploy-drawer/state'
import { deploymentStatusPollingInterval, hasRuntimeInstanceDeployment } from '../../shared/domain/runtime-status'

export function NewDeploymentButton({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)

  return (
    <Button
      size="medium"
      variant="primary"
      className="gap-1.5"
      onClick={() => openDeployDrawer({ appInstanceId })}
    >
      <span className="i-ri-rocket-line size-4 shrink-0" aria-hidden="true" />
      {t('deployTab.newDeployment')}
    </Button>
  )
}

export function NewDeploymentHeaderAction({ appInstanceId }: {
  appInstanceId: string
}) {
  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: { appInstanceId },
    },
    refetchInterval: query => deploymentStatusPollingInterval(query.state.data?.environmentDeployments),
  }))
  const rows = environmentDeploymentsQuery.data?.environmentDeployments.filter(hasRuntimeInstanceDeployment) ?? []

  if (environmentDeploymentsQuery.isLoading || environmentDeploymentsQuery.isError || rows.length === 0)
    return null

  return <NewDeploymentButton appInstanceId={appInstanceId} />
}
