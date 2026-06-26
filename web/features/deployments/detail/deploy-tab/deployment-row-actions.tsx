'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { consoleQuery } from '@/service/client'
import { openDeployDrawerAtom } from '../../deploy-drawer/state'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'
import { createDeploymentIdempotencyKey } from '../../shared/domain/idempotency'
import { isRuntimeDeploymentInProgress, isUndeployedDeploymentRow } from '../../shared/domain/runtime-status'
import { DeploymentErrorDialog } from './deployment-error-dialog'
import { DeploymentActionsDropdown } from './deployment-row-actions-menu'
import { UndeployDeploymentDialog } from './undeploy-deployment-dialog'

export function DeploymentRowActions({ row }: {
  row: EnvironmentDeployment
}) {
  const routeAppInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const undeployDeployment = useMutation(consoleQuery.enterprise.deploymentService.undeploy.mutationOptions())
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const [showErrorDetail, setShowErrorDetail] = useState(false)
  const envId = row.environment.id
  const isUndeployed = isUndeployedDeploymentRow(row)
  const status = row.status
  const isUndeployRequesting = undeployDeployment.isPending
  const undeployActionDisabled = isUndeployRequesting
  const isDeploymentInProgress = isRuntimeDeploymentInProgress(status)
  const isDeployFailed = status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED

  if (!routeAppInstanceId)
    return null

  const appInstanceId = routeAppInstanceId

  function handleDeployAction(releaseId?: string) {
    openDeployDrawer({ appInstanceId, environmentId: envId, releaseId })
  }

  function handleUndeploy() {
    if (isUndeployRequesting)
      return

    undeployDeployment.mutate(
      {
        params: { appInstanceId, environmentId: envId },
        body: {
          appInstanceId,
          environmentId: envId,
          idempotencyKey: createDeploymentIdempotencyKey(),
        },
      },
      {
        onSettled: () => {
          setShowUndeployConfirm(false)
        },
      },
    )
  }

  return (
    <div
      role="presentation"
      className="flex shrink-0 items-center"
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      <DeploymentActionsDropdown
        row={row}
        undeployActionDisabled={undeployActionDisabled}
        onDeploy={handleDeployAction}
        onRequestUndeploy={() => setShowUndeployConfirm(true)}
        onViewError={() => setShowErrorDetail(true)}
      />

      <DeploymentErrorDialog
        open={showErrorDetail && isDeployFailed}
        row={row}
        onOpenChange={setShowErrorDetail}
      />

      <UndeployDeploymentDialog
        open={showUndeployConfirm && !isUndeployed && !isDeploymentInProgress}
        row={row}
        isRequesting={isUndeployRequesting}
        disabled={undeployActionDisabled}
        onConfirm={handleUndeploy}
        onOpenChange={setShowUndeployConfirm}
      />
    </div>
  )
}
