'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openDeployDrawerAtom } from '../../deploy-drawer/state'
import { createDeploymentIdempotencyKey } from '../../shared/domain/idempotency'
import { isRuntimeDeploymentInProgress, isUndeployedDeploymentRow } from '../../shared/domain/runtime-status'
import { createUndeployDeploymentMutationAtom } from '../state'
import { DeploymentErrorDialog } from './deployment-error-dialog'
import { DeploymentActionsDropdown } from './deployment-row-actions-menu'
import { UndeployDeploymentDialog } from './undeploy-deployment-dialog'

export function DeploymentRowActions({ appInstanceId, envId, row }: {
  appInstanceId: string
  envId: string
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const undeployDeploymentMutationAtom = useMemo(() => createUndeployDeploymentMutationAtom(), [])
  const undeployDeployment = useAtomValue(undeployDeploymentMutationAtom)
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const [showErrorDetail, setShowErrorDetail] = useState(false)
  const isUndeployed = isUndeployedDeploymentRow(row)
  const status = row.status
  const isUndeployRequesting = undeployDeployment.isPending
  const undeployActionDisabled = isUndeployRequesting
  const isDeploymentInProgress = isRuntimeDeploymentInProgress(status)
  const isDeployFailed = status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED
  const currentReleaseId = row.currentRelease?.id
  const failedReleaseId = row.desiredRelease?.id ?? row.currentRelease?.id
  const deployActionLabel = isUndeployed
    ? t('deployDrawer.deploy')
    : t('deployTab.deployOtherVersion')

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
        currentReleaseId={currentReleaseId}
        deployActionLabel={deployActionLabel}
        failedReleaseId={failedReleaseId}
        isDeployFailed={isDeployFailed}
        isDeploymentInProgress={isDeploymentInProgress}
        isUndeployed={isUndeployed}
        undeployActionDisabled={undeployActionDisabled}
        onDeploy={handleDeployAction}
        onRequestUndeploy={() => setShowUndeployConfirm(true)}
        onViewError={() => setShowErrorDetail(true)}
      />

      {isDeployFailed && (
        <DeploymentErrorDialog
          open={showErrorDetail}
          row={row}
          onOpenChange={setShowErrorDetail}
        />
      )}

      {!isUndeployed && !isDeploymentInProgress && (
        <UndeployDeploymentDialog
          open={showUndeployConfirm}
          row={row}
          isRequesting={isUndeployRequesting}
          disabled={undeployActionDisabled}
          onConfirm={handleUndeploy}
          onOpenChange={setShowUndeployConfirm}
        />
      )}
    </div>
  )
}
