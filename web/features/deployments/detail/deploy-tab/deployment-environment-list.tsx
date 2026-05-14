'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useMutation } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import {
  environmentId,
  environmentName,
} from '../../environment'
import { releaseCommit, releaseLabel } from '../../release'
import { deploymentStatus, isUndeployedDeploymentRow } from '../../runtime-status'
import { openDeployDrawerAtom } from '../../store'
import { DeploymentStatusSummary } from './deployment-status-summary'

const GRID_TEMPLATE = 'lg:grid-cols-[minmax(180px,0.9fr)_minmax(220px,1fr)_max-content]'

function CurrentReleaseSummary({ release }: {
  release: EnvironmentDeployment['currentRelease']
}) {
  const { t } = useTranslation('deployments')

  if (!release?.id && !release?.name)
    return <div className="hidden lg:block" aria-hidden="true" />

  const commit = releaseCommit(release)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="system-2xs-medium-uppercase text-text-tertiary">
        {t('deployTab.col.currentRelease')}
      </span>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate font-mono system-sm-medium text-text-primary">
          {releaseLabel(release)}
        </span>
        {commit !== '—' && (
          <span className="shrink-0 font-mono system-xs-regular text-text-tertiary">
            {commit}
          </span>
        )}
      </div>
    </div>
  )
}

function DeploymentRowActions({ appInstanceId, envId, row }: {
  appInstanceId: string
  envId: string
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const cancelDeployment = useMutation(consoleQuery.enterprise.appDeploymentService.cancelDeployment.mutationOptions())
  const undeployDeployment = useMutation(consoleQuery.enterprise.appDeploymentService.undeployRuntimeInstance.mutationOptions())
  const isUndeployed = isUndeployedDeploymentRow(row)
  const status = deploymentStatus(row)
  const deploymentId = row.runtime?.currentDeploymentId
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const pendingMutation = cancelDeployment.isPending || undeployDeployment.isPending
  const secondaryActionDisabled = pendingMutation || (status === 'deploying' ? !deploymentId : !envId)

  function handleCancelDeployment() {
    if (!envId || !deploymentId)
      return
    cancelDeployment.mutate({
      params: { appInstanceId, environmentId: envId, deploymentId },
      body: { appInstanceId, environmentId: envId, deploymentId },
    })
  }

  function handleUndeploy() {
    if (!envId)
      return
    undeployDeployment.mutate(
      {
        params: { appInstanceId, environmentId: envId },
        body: { appInstanceId, environmentId: envId },
      },
      {
        onSettled: () => setShowUndeployConfirm(false),
      },
    )
  }

  return (
    <div
      className="flex shrink-0 items-center gap-2"
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      <Button
        size="small"
        variant="secondary"
        className="px-2.5"
        onClick={() => openDeployDrawer({ appInstanceId, environmentId: envId })}
      >
        {isUndeployed
          ? t('deployDrawer.deploy')
          : status === 'ready'
            ? t('deployTab.deployOtherVersion')
            : status === 'deploying'
              ? t('deployTab.viewProgress')
              : status === 'deploy_failed'
                ? t('deployTab.viewError')
                : t('deployTab.deployOtherVersion')}
      </Button>
      {!isUndeployed && (
        status === 'deploying'
          ? (
              <Button
                size="small"
                variant="ghost"
                tone="destructive"
                className="px-2.5"
                disabled={secondaryActionDisabled}
                loading={cancelDeployment.isPending}
                onClick={handleCancelDeployment}
              >
                {t('deployTab.cancelDeployment')}
              </Button>
            )
          : (
              <Button
                size="small"
                variant="ghost"
                tone="destructive"
                className="px-2.5"
                disabled={secondaryActionDisabled}
                loading={undeployDeployment.isPending}
                onClick={() => setShowUndeployConfirm(true)}
              >
                {t('deployTab.undeploy')}
              </Button>
            )
      )}

      {!isUndeployed && (
        <AlertDialog
          open={showUndeployConfirm}
          onOpenChange={open => !open && setShowUndeployConfirm(false)}
        >
          <AlertDialogContent className="w-130">
            <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
              <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                {t('deployTab.undeployConfirmTitle', { name: environmentName(row.environment) })}
              </AlertDialogTitle>
              <AlertDialogDescription className="system-md-regular text-text-tertiary">
                {t('deployTab.undeployConfirmDesc')}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton variant="secondary">
                {t('deployDrawer.cancel')}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton onClick={handleUndeploy}>
                {t('deployTab.confirmUndeploy')}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

function DeploymentEnvironmentRow({ appInstanceId, row }: {
  appInstanceId: string
  row: EnvironmentDeployment
}) {
  const envId = environmentId(row.environment)
  const release = row.currentRelease
  const status = deploymentStatus(row)
  const showFailureBanner = status === 'deploy_failed' && Boolean(row.status)

  return (
    <div className="border-b border-divider-subtle last:border-b-0">
      <div
        className={cn(
          'flex flex-col gap-3 py-3 text-left',
          'lg:grid lg:items-center lg:gap-6',
          GRID_TEMPLATE,
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate system-sm-semibold text-text-primary">{environmentName(row.environment)}</span>
          <DeploymentStatusSummary row={row} />
        </div>
        {isUndeployedDeploymentRow(row)
          ? <div className="hidden lg:block" aria-hidden="true" />
          : <CurrentReleaseSummary release={release} />}
        <div className="flex min-w-0 items-center justify-start gap-2 lg:justify-end">
          <DeploymentRowActions appInstanceId={appInstanceId} envId={envId} row={row} />
        </div>
      </div>
      {showFailureBanner && (
        <div className="flex items-center gap-2 border-l-2 border-util-colors-red-red-500 bg-util-colors-red-red-50 px-3 py-2 system-xs-regular text-util-colors-red-red-700">
          <span aria-hidden className="i-ri-alert-line size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{row.status}</span>
        </div>
      )}
    </div>
  )
}

export function DeploymentEnvironmentList({ appInstanceId, rows }: {
  appInstanceId: string
  rows: EnvironmentDeployment[]
}) {
  return (
    <div className="overflow-visible border-y border-divider-subtle">
      {rows.map((row) => {
        const envId = environmentId(row.environment)
        return (
          <DeploymentEnvironmentRow
            key={envId}
            appInstanceId={appInstanceId}
            row={row}
          />
        )
      })}
    </div>
  )
}
