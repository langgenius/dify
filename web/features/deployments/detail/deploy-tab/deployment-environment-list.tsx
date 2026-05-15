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
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
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
import {
  DETAIL_LIST_ACTION_TRIGGER_CLASS_NAME,
  DETAIL_LIST_CLASS_NAME,
  DETAIL_LIST_ROW_CLASS_NAME,
} from '../list-styles'
import { DeploymentStatusSummary } from './deployment-status-summary'

function EnvironmentSummary({ environment }: {
  environment: EnvironmentDeployment['environment']
}) {
  return (
    <span className="block truncate system-sm-semibold text-text-primary">
      {environmentName(environment)}
    </span>
  )
}

function CurrentReleaseSummary({ release }: {
  release: EnvironmentDeployment['currentRelease']
}) {
  if (!release?.id && !release?.name)
    return <span className="system-sm-regular text-text-quaternary">—</span>

  const commit = releaseCommit(release)

  return (
    <div className="flex min-w-0 flex-col gap-1">
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
  const undeployDeployment = useMutation(consoleQuery.enterprise.appDeploymentService.undeployRuntimeInstance.mutationOptions())
  const isUndeployed = isUndeployedDeploymentRow(row)
  const status = deploymentStatus(row)
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const undeployActionDisabled = undeployDeployment.isPending || !envId
  const isDeploying = status === 'deploying'
  const deployActionLabel = isUndeployed
    ? t('deployDrawer.deploy')
    : status === 'deploy_failed'
      ? t('deployTab.viewError')
      : t('deployTab.deployOtherVersion')

  function handleDeployAction() {
    openDeployDrawer({ appInstanceId, environmentId: envId })
    setActionsOpen(false)
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
      className="flex shrink-0 items-center"
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      {!isDeploying && (
        <DropdownMenu modal={false} open={actionsOpen} onOpenChange={setActionsOpen}>
          <DropdownMenuTrigger
            aria-label={t('deployTab.moreActions')}
            className={DETAIL_LIST_ACTION_TRIGGER_CLASS_NAME}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </DropdownMenuTrigger>
          {actionsOpen && (
            <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-44">
              <DropdownMenuItem
                className="gap-2 px-3"
                onClick={handleDeployAction}
              >
                <span aria-hidden className="i-ri-rocket-line size-4 shrink-0 text-text-tertiary" />
                <span className="system-sm-regular text-text-secondary">{deployActionLabel}</span>
              </DropdownMenuItem>
              {!isUndeployed && (
                <>
                  <div className="my-1 border-t border-divider-subtle" aria-hidden />
                  <DropdownMenuItem
                    disabled={undeployActionDisabled}
                    aria-disabled={undeployActionDisabled}
                    className={cn(
                      'gap-2 px-3 text-util-colors-red-red-600',
                      undeployActionDisabled && 'cursor-not-allowed opacity-60',
                    )}
                    onClick={() => {
                      if (undeployActionDisabled)
                        return
                      setActionsOpen(false)
                      setShowUndeployConfirm(true)
                    }}
                  >
                    <span aria-hidden className="i-ri-logout-box-line size-4 shrink-0" />
                    <span className="system-sm-regular">{t('deployTab.undeploy')}</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      )}

      {!isUndeployed && !isDeploying && (
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

function CurrentReleaseMobileSummary({ release }: {
  release: EnvironmentDeployment['currentRelease']
}) {
  const { t } = useTranslation('deployments')

  if (!release?.id && !release?.name)
    return null

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="system-2xs-medium-uppercase text-text-tertiary">
        {t('deployTab.col.currentRelease')}
      </span>
      <CurrentReleaseSummary release={release} />
    </div>
  )
}

function DeploymentEnvironmentMobileRow({ appInstanceId, row }: {
  appInstanceId: string
  row: EnvironmentDeployment
}) {
  const envId = environmentId(row.environment)
  const release = row.currentRelease
  const status = deploymentStatus(row)
  const showFailureBanner = status === 'deploy_failed' && Boolean(row.status)

  return (
    <div className="border-b border-divider-subtle last:border-b-0">
      <div className="flex flex-col gap-3 p-4 text-left">
        <div className="flex min-w-0 flex-col gap-1">
          <EnvironmentSummary environment={row.environment} />
          <DeploymentStatusSummary row={row} />
        </div>
        {!isUndeployedDeploymentRow(row) && <CurrentReleaseMobileSummary release={release} />}
        <div className="flex min-w-0 items-center justify-start gap-2">
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

function DeploymentEnvironmentDesktopRows({ appInstanceId, rows }: {
  appInstanceId: string
  rows: EnvironmentDeployment[]
}) {
  return (
    <>
      {rows.map((row, index) => {
        const envId = environmentId(row.environment)
        const status = deploymentStatus(row)
        const showFailureBanner = status === 'deploy_failed' && Boolean(row.status)
        const isLast = index === rows.length - 1

        return (
          <div
            key={envId}
            className={DETAIL_LIST_ROW_CLASS_NAME}
          >
            <div className="grid min-h-12 grid-cols-[minmax(160px,1fr)_minmax(150px,0.75fr)_minmax(180px,1fr)_auto] items-center gap-6 px-4 py-2">
              <div className="min-w-0">
                <EnvironmentSummary environment={row.environment} />
              </div>
              <div className="min-w-0">
                <DeploymentStatusSummary row={row} />
              </div>
              <div className="min-w-0">
                <CurrentReleaseSummary release={row.currentRelease} />
              </div>
              <div className="flex justify-end">
                <DeploymentRowActions appInstanceId={appInstanceId} envId={envId} row={row} />
              </div>
            </div>
            {showFailureBanner && (
              <div className={cn('flex items-center gap-2 border-t border-l-2 border-divider-subtle border-l-util-colors-red-red-500 bg-util-colors-red-red-50 px-4 py-2 system-xs-regular text-util-colors-red-red-700', isLast && 'rounded-b-lg')}>
                <span aria-hidden className="i-ri-alert-line size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{row.status}</span>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export function DeploymentEnvironmentList({ appInstanceId, rows }: {
  appInstanceId: string
  rows: EnvironmentDeployment[]
}) {
  return (
    <>
      <div className={cn(DETAIL_LIST_CLASS_NAME, 'pc:hidden')}>
        {rows.map(row => (
          <DeploymentEnvironmentMobileRow
            key={environmentId(row.environment)}
            appInstanceId={appInstanceId}
            row={row}
          />
        ))}
      </div>
      <div className="hidden pc:block">
        <div className={DETAIL_LIST_CLASS_NAME}>
          <DeploymentEnvironmentDesktopRows appInstanceId={appInstanceId} rows={rows} />
        </div>
      </div>
    </>
  )
}
