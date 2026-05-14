'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import type { KeyboardEvent } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/client'
import {
  environmentBackend,
  environmentId,
  environmentMode,
  environmentName,
} from '../../environment'
import { formatDate, releaseCommit, releaseLabel } from '../../release'
import { deploymentStatus, isUndeployedDeploymentRow } from '../../runtime-status'
import { openDeployDrawerAtom } from '../../store'
import { DeploymentPanel } from './deployment-panel'
import { DeploymentStatusSummary } from './deployment-status-summary'

const GRID_TEMPLATE = 'lg:grid-cols-[minmax(0,1fr)_max-content]'

function ReleaseCreatedAtLine({ release }: {
  release: EnvironmentDeployment['currentRelease']
}) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  if (!release?.createdAt)
    return null
  const ms = Date.parse(release.createdAt)
  if (Number.isNaN(ms))
    return null
  return (
    <>
      <span>·</span>
      <Tooltip>
        <TooltipTrigger
          render={(
            <span className="cursor-default">
              {t('deployTab.releaseCreatedAt', { time: formatTimeFromNow(ms) })}
            </span>
          )}
        />
        <TooltipContent>{formatDate(release.createdAt)}</TooltipContent>
      </Tooltip>
    </>
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const pendingMutation = cancelDeployment.isPending || undeployDeployment.isPending

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
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label={t('deployTab.moreActions')}
            className={cn(
              'flex size-7 items-center justify-center rounded-md border-none bg-transparent text-text-tertiary hover:bg-state-base-hover data-popup-open:bg-state-base-hover',
            )}
            disabled={pendingMutation || (status === 'deploying' ? !deploymentId : !envId)}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-48">
            {status === 'deploying' && (
              <DropdownMenuItem
                className="gap-2 px-3"
                onClick={() => {
                  setMenuOpen(false)
                  handleCancelDeployment()
                }}
              >
                <span className="system-sm-regular text-text-secondary">
                  {t('deployTab.cancelDeployment')}
                </span>
              </DropdownMenuItem>
            )}
            {status !== 'deploying' && (
              <DropdownMenuItem
                className="gap-2 px-3"
                onClick={() => {
                  setMenuOpen(false)
                  setShowUndeployConfirm(true)
                }}
              >
                <span className="system-sm-regular text-util-colors-red-red-600">
                  {t('deployTab.undeploy')}
                </span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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
    </div>
  )
}

function DeploymentEnvironmentRow({ appInstanceId, row, isExpanded, onToggle }: {
  appInstanceId: string
  row: EnvironmentDeployment
  isExpanded: boolean
  onToggle: (envId: string) => void
}) {
  const { t } = useTranslation('deployments')
  const envId = environmentId(row.environment)
  const isUndeployed = isUndeployedDeploymentRow(row)
  const release = row.currentRelease
  const status = deploymentStatus(row)
  const showFailureBanner = !isExpanded && status === 'deploy_failed' && Boolean(row.status)

  function handleRowToggle() {
    if (!isUndeployed)
      onToggle(envId)
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isUndeployed)
      return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(envId)
    }
  }

  const expandButton = !isUndeployed && (
    <button
      type="button"
      aria-expanded={isExpanded}
      aria-label={t(isExpanded ? 'deployTab.collapseDetails' : 'deployTab.expandDetails')}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary"
      onClick={(event) => {
        event.stopPropagation()
        handleRowToggle()
      }}
    >
      <span
        className={cn(
          'i-ri-arrow-down-s-line size-4 transition-transform',
          !isExpanded && '-rotate-90',
        )}
        aria-hidden="true"
      />
    </button>
  )
  const expandControl = expandButton && (
    <div className="ml-1 flex shrink-0 items-center border-l border-divider-subtle pl-2">
      {expandButton}
    </div>
  )

  return (
    <div className="border-b border-divider-subtle last:border-b-0">
      <div
        role={isUndeployed ? undefined : 'button'}
        tabIndex={isUndeployed ? undefined : 0}
        onClick={handleRowToggle}
        onKeyDown={handleRowKeyDown}
        className={cn(
          'flex flex-col gap-3 py-3 text-left',
          !isUndeployed && 'cursor-pointer',
          'lg:grid lg:items-center lg:gap-6',
          GRID_TEMPLATE,
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate system-sm-semibold text-text-primary">{environmentName(row.environment)}</span>
              <DeploymentStatusSummary row={row} />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 system-xs-regular text-text-tertiary">
              <span className="uppercase">{environmentBackend(row.environment)}</span>
              <span>·</span>
              <span>{t(environmentMode(row.environment) === 'isolated' ? 'mode.isolated' : 'mode.shared')}</span>
              {!isUndeployed && (
                <>
                  <span>·</span>
                  <span className="font-mono text-text-secondary">{releaseLabel(release)}</span>
                  <span className="font-mono">{releaseCommit(release)}</span>
                  <ReleaseCreatedAtLine release={release} />
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            <DeploymentRowActions appInstanceId={appInstanceId} envId={envId} row={row} />
            {expandControl}
          </div>
        </div>
        <div className="hidden min-w-0 items-center justify-end gap-2 lg:flex">
          <DeploymentRowActions appInstanceId={appInstanceId} envId={envId} row={row} />
          {expandControl}
        </div>
      </div>
      {showFailureBanner && (
        <div className="flex items-center gap-2 border-l-2 border-util-colors-red-red-500 bg-util-colors-red-red-50 px-3 py-2 system-xs-regular text-util-colors-red-red-700">
          <span aria-hidden className="i-ri-alert-line size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{row.status}</span>
          <button
            type="button"
            className="shrink-0 system-xs-medium underline-offset-2 hover:underline"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(envId)
            }}
          >
            {t('deployTab.viewError')}
          </button>
        </div>
      )}
      {isExpanded && (
        <div className="border-t border-divider-subtle py-4">
          <DeploymentPanel row={row} />
        </div>
      )}
    </div>
  )
}

export function DeploymentEnvironmentList({ appInstanceId, rows }: {
  appInstanceId: string
  rows: EnvironmentDeployment[]
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  function toggleExpandedEnv(envId: string) {
    setExpanded(prev => (prev === envId ? null : envId))
  }

  return (
    <div className="overflow-visible border-y border-divider-subtle">
      {rows.map((row) => {
        const envId = environmentId(row.environment)
        const isExpanded = !isUndeployedDeploymentRow(row) && expanded === envId
        return (
          <DeploymentEnvironmentRow
            key={envId}
            appInstanceId={appInstanceId}
            row={row}
            isExpanded={isExpanded}
            onToggle={toggleExpandedEnv}
          />
        )
      })}
    </div>
  )
}
