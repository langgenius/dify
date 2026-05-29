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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMutation } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import {
  environmentId,
  environmentName,
} from '../../environment'
import { createDeploymentIdempotencyKey } from '../../idempotency'
import { releaseCommit, releaseLabel } from '../../release'
import { deploymentStatus, isUndeployedDeploymentRow } from '../../runtime-status'
import { openDeployDrawerAtom } from '../../store'
import {
  DetailTable,
  DetailTableBody,
  DetailTableCard,
  DetailTableCardList,
  DetailTableCell,
  DetailTableHead,
  DetailTableHeader,
  DetailTableRow,
} from '../table'
import {
  DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES,
  DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME,
} from '../table-styles'
import { DeploymentStatusSummary } from './deployment-status-summary'

function EnvironmentSummary({ environment }: {
  environment: EnvironmentDeployment['environment']
}) {
  return (
    <span className="block truncate text-text-primary">
      {environmentName(environment)}
    </span>
  )
}

function CurrentReleaseSummary({ release }: {
  release: EnvironmentDeployment['currentRelease']
}) {
  if (!release?.id && !release?.name)
    return <span className="text-text-quaternary">—</span>

  const commit = releaseCommit(release)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-text-primary">
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

type DeploymentErrorDetailsProps = {
  error?: EnvironmentDeployment['error']
}

function DeploymentErrorDetails({ error }: DeploymentErrorDetailsProps) {
  const { t } = useTranslation('deployments')
  const message = error?.message?.trim() || t('deployTab.panel.unknownError')
  const metadata = [
    error?.phase ? { label: t('deployTab.errorPhase'), value: error.phase } : undefined,
    error?.code ? { label: t('deployTab.errorCode'), value: error.code } : undefined,
  ].filter((item): item is { label: string, value: string } => Boolean(item))

  return (
    <div className="rounded-xl border border-divider-subtle bg-background-default-subtle p-3">
      <div className="system-xs-medium-uppercase text-text-tertiary">
        {t('deployTab.errorMessage')}
      </div>
      <div className="mt-1 system-sm-regular break-words whitespace-pre-wrap text-text-secondary">
        {message}
      </div>
      {metadata.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {metadata.map(item => (
            <span
              key={item.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-divider-subtle bg-background-default px-2 py-1 system-xs-regular text-text-tertiary"
            >
              <span className="shrink-0 text-text-quaternary">{item.label}</span>
              <span className="truncate font-mono text-text-secondary">{item.value}</span>
            </span>
          ))}
        </div>
      )}
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
  const undeployDeployment = useMutation(consoleQuery.enterprise.deploymentService.undeploy.mutationOptions())
  const isUndeployed = isUndeployedDeploymentRow(row)
  const status = deploymentStatus(row)
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const [showErrorDetail, setShowErrorDetail] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [isUndeploying, setIsUndeploying] = useState(false)
  const undeployInFlightRef = useRef(false)
  const isUndeployRequesting = undeployDeployment.isPending || isUndeploying
  const undeployActionDisabled = isUndeployRequesting || !envId
  const isDeploying = status === 'deploying'
  const isDeployFailed = status === 'deploy_failed'
  const failedReleaseId = row.desiredRelease?.id || row.currentRelease?.id
  const deployActionLabel = isUndeployed
    ? t('deployDrawer.deploy')
    : t('deployTab.deployOtherVersion')

  function handleDeployAction(releaseId?: string) {
    openDeployDrawer({ appInstanceId, environmentId: envId, releaseId })
    setActionsOpen(false)
  }

  function handleViewError() {
    setActionsOpen(false)
    setShowErrorDetail(true)
  }

  function handleUndeploy() {
    if (!envId || undeployInFlightRef.current)
      return
    undeployInFlightRef.current = true
    setIsUndeploying(true)
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
          undeployInFlightRef.current = false
          setIsUndeploying(false)
          setShowUndeployConfirm(false)
        },
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
            className={DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </DropdownMenuTrigger>
          {actionsOpen && (
            <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-44">
              {isDeployFailed
                ? (
                    <>
                      <DropdownMenuItem
                        className="gap-2 px-3"
                        onClick={handleViewError}
                      >
                        <span aria-hidden className="i-ri-error-warning-line size-4 shrink-0 text-text-tertiary" />
                        <span className="system-sm-regular text-text-secondary">{t('deployTab.viewError')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 px-3"
                        onClick={() => handleDeployAction(failedReleaseId)}
                      >
                        <span aria-hidden className="i-ri-refresh-line size-4 shrink-0 text-text-tertiary" />
                        <span className="system-sm-regular text-text-secondary">
                          {failedReleaseId ? t('deployTab.retry') : t('deployTab.deployOtherVersion')}
                        </span>
                      </DropdownMenuItem>
                    </>
                  )
                : (
                    <DropdownMenuItem
                      className="gap-2 px-3"
                      onClick={() => handleDeployAction()}
                    >
                      <span aria-hidden className="i-ri-rocket-line size-4 shrink-0 text-text-tertiary" />
                      <span className="system-sm-regular text-text-secondary">{deployActionLabel}</span>
                    </DropdownMenuItem>
                  )}
              {!isUndeployed && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={undeployActionDisabled}
                    aria-disabled={undeployActionDisabled}
                    className={cn(
                      'gap-2 px-3',
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

      {isDeployFailed && (
        <AlertDialog open={showErrorDetail} onOpenChange={setShowErrorDetail}>
          <AlertDialogContent className="w-120">
            <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
              <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                {t('deployTab.errorDialogTitle', { name: environmentName(row.environment) })}
              </AlertDialogTitle>
              <AlertDialogDescription className="system-sm-regular text-text-tertiary">
                {t('deployTab.errorDialogDesc')}
              </AlertDialogDescription>
              <DeploymentErrorDetails error={row.error} />
            </div>
            <AlertDialogActions className="pt-3">
              <AlertDialogCancelButton variant="secondary">
                {t('deployTab.closeError')}
              </AlertDialogCancelButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {!isUndeployed && !isDeploying && (
        <AlertDialog
          open={showUndeployConfirm}
          onOpenChange={(open) => {
            if (isUndeployRequesting)
              return
            setShowUndeployConfirm(open)
          }}
        >
          <AlertDialogContent className="w-120">
            <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
              <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                {t('deployTab.undeployConfirmTitle', { name: environmentName(row.environment) })}
              </AlertDialogTitle>
              <AlertDialogDescription className="system-sm-regular text-text-tertiary">
                {t('deployTab.undeployConfirmDesc')}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions className="pt-3">
              <AlertDialogCancelButton variant="secondary" disabled={isUndeployRequesting}>
                {t('deployDrawer.cancel')}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                loading={isUndeployRequesting}
                disabled={undeployActionDisabled}
                onClick={handleUndeploy}
              >
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

  return (
    <DetailTableCard>
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
    </DetailTableCard>
  )
}

function DeploymentEnvironmentDesktopRows({ appInstanceId, rows }: {
  appInstanceId: string
  rows: EnvironmentDeployment[]
}) {
  return (
    <>
      {rows.map((row) => {
        const envId = environmentId(row.environment)
        return (
          <DetailTableRow key={envId}>
            <DetailTableCell>
              <EnvironmentSummary environment={row.environment} />
            </DetailTableCell>
            <DetailTableCell>
              <DeploymentStatusSummary row={row} />
            </DetailTableCell>
            <DetailTableCell>
              <CurrentReleaseSummary release={row.currentRelease} />
            </DetailTableCell>
            <DetailTableCell>
              <div className="flex min-h-8 justify-end">
                <DeploymentRowActions appInstanceId={appInstanceId} envId={envId} row={row} />
              </div>
            </DetailTableCell>
          </DetailTableRow>
        )
      })}
    </>
  )
}

export function DeploymentEnvironmentList({ appInstanceId, rows }: {
  appInstanceId: string
  rows: EnvironmentDeployment[]
}) {
  const { t } = useTranslation('deployments')

  return (
    <>
      <DetailTableCardList className="pc:hidden">
        {rows.map(row => (
          <DeploymentEnvironmentMobileRow
            key={environmentId(row.environment)}
            appInstanceId={appInstanceId}
            row={row}
          />
        ))}
      </DetailTableCardList>
      <div className="hidden pc:block">
        <DetailTable>
          <DetailTableHeader>
            <DetailTableRow>
              <DetailTableHead className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>{t('deployTab.col.environment')}</DetailTableHead>
              <DetailTableHead className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.status}>{t('deployTab.col.status')}</DetailTableHead>
              <DetailTableHead className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.currentRelease}>{t('deployTab.col.currentRelease')}</DetailTableHead>
              <DetailTableHead className={`${DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.actions} text-right`}>{t('deployTab.col.actions')}</DetailTableHead>
            </DetailTableRow>
          </DetailTableHeader>
          <DetailTableBody>
            <DeploymentEnvironmentDesktopRows appInstanceId={appInstanceId} rows={rows} />
          </DetailTableBody>
        </DetailTable>
      </div>
    </>
  )
}
