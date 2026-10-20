'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentDialogRequest, OpenDeploymentDialog } from '../types'
import type { OpenUndeployDialog, UndeployHandler } from './types'
import { AlertDialog } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { useAtomValue } from 'jotai'
import dynamic from 'next/dynamic'
import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'
import {
  appEnvironmentDeploymentsAtom,
  appEnvironmentDeploymentsIsErrorAtom,
  appEnvironmentDeploymentsIsLoadingAtom,
  appEnvironmentDeploymentsIsRetryingAtom,
  appEnvironmentDeploymentsRefetchAtom,
  appEnvironmentUsageAtom,
  latestAppWorkflowVersionAtom,
  latestAppWorkflowVersionIsErrorAtom,
  latestAppWorkflowVersionIsRetryingAtom,
  latestAppWorkflowVersionRefetchAtom,
} from '../state'
import { EnvironmentDeployMenu } from './deploy-menu'
import { EnvironmentTableEmpty } from './empty-state'
import { EnvironmentRow } from './row'
import { UndeployConfirmDialogContent } from './undeploy-confirm-dialog'

const DeploymentDialogContent = dynamic(() =>
  import('../deployment-dialog').then((module) => module.DeploymentDialogContent),
)

type EnvironmentTableProps = {
  appId: string
  canViewAccessPoint: boolean
  onUndeploy: UndeployHandler
}

function EnvironmentTableColumns() {
  return (
    <colgroup>
      <col className="w-43" />
      <col className="w-46" />
      <col className="w-44" />
      <col />
      <col className="w-36" />
      <col className="w-44" />
    </colgroup>
  )
}

function EnvironmentTableHeader() {
  const { t } = useTranslation(['deployments'])

  return (
    <thead>
      <tr className="sticky top-0 z-10 h-7 bg-background-section-burn">
        <th
          scope="col"
          className="rounded-l-lg pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary"
        >
          {t(($) => $['deployTab.col.environment'])}
        </th>
        <th
          scope="col"
          className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary"
        >
          {t(($) => $['studio.liveVersion'])}
        </th>
        <th
          scope="col"
          className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary"
        >
          {t(($) => $['deployTab.col.status'])}
        </th>
        <th
          scope="col"
          className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary"
        >
          {t(($) => $['studio.lastActivity'])}
        </th>
        <th
          scope="col"
          className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary"
        >
          {t(($) => $['studio.accessPoints'])}
        </th>
        <th
          scope="col"
          className="rounded-r-lg pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary"
        >
          {t(($) => $['deployTab.col.actions'])}
        </th>
      </tr>
    </thead>
  )
}

export const EnvironmentTable = memo(
  ({ appId, canViewAccessPoint, onUndeploy }: EnvironmentTableProps) => {
    const { t } = useTranslation(['deployments'])
    const { t: tCommon } = useTranslation(['common'])
    const { t: tWorkflow } = useTranslation(['workflowHistory'])
    const environmentsTitleRef = useRef<HTMLHeadingElement | null>(null)
    const [deploymentSession, setDeploymentSession] = useState<{
      open: boolean
      request: DeploymentDialogRequest
      returnFocusElement: HTMLElement | null
    }>()
    const [undeploySession, setUndeploySession] = useState<{
      open: boolean
      deployment: EnvironmentDeployment
      returnFocusElement: HTMLElement | null
    }>()
    const openDeployment = useCallback<OpenDeploymentDialog>((request, returnFocusElement) => {
      setDeploymentSession({ open: true, request, returnFocusElement })
    }, [])
    const openUndeploy = useCallback<OpenUndeployDialog>((deployment, returnFocusElement) => {
      setUndeploySession({ open: true, deployment, returnFocusElement })
    }, [])
    const closeDeployment = () =>
      setDeploymentSession((session) => session && { ...session, open: false })
    const [isUndeploying, setIsUndeploying] = useState(false)
    const deployments = useAtomValue(appEnvironmentDeploymentsAtom) ?? []
    const isLoading = useAtomValue(appEnvironmentDeploymentsIsLoadingAtom)
    const isError = useAtomValue(appEnvironmentDeploymentsIsErrorAtom)
    const isRetrying = useAtomValue(appEnvironmentDeploymentsIsRetryingAtom)
    const refetchDeployments = useAtomValue(appEnvironmentDeploymentsRefetchAtom)
    const usage = useAtomValue(appEnvironmentUsageAtom)
    const latestVersion = useAtomValue(latestAppWorkflowVersionAtom)
    const latestVersionIsError = useAtomValue(latestAppWorkflowVersionIsErrorAtom)
    const latestVersionIsRetrying = useAtomValue(latestAppWorkflowVersionIsRetryingAtom)
    const refetchLatestVersion = useAtomValue(latestAppWorkflowVersionRefetchAtom)
    const deployableLatestVersion = latestVersionIsError ? undefined : latestVersion
    const showLoadingState = isLoading && deployments.length === 0
    const showErrorState = isError && deployments.length === 0
    const showEmptyState = !isLoading && !isError && deployments.length === 0

    const handleUndeploy = async (deployment: EnvironmentDeployment) => {
      if (isUndeploying) return

      setIsUndeploying(true)
      try {
        await onUndeploy(deployment)
        setUndeploySession((session) => session && { ...session, open: false })
      } catch {
        // The request layer reports the error; keep the dialog open so the user can retry.
      } finally {
        setIsUndeploying(false)
      }
    }

    return (
      <>
        <section
          aria-labelledby="deploy-environments-title"
          aria-busy={showLoadingState || isRetrying || latestVersionIsRetrying}
          className="flex min-h-60 min-w-0 grow flex-col gap-3"
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2
                ref={environmentsTitleRef}
                id="deploy-environments-title"
                tabIndex={-1}
                className="truncate system-md-semibold text-text-primary"
              >
                {t(($) => $['studio.environments'])}
              </h2>
              {usage && (
                <>
                  <span aria-hidden className="system-xs-regular text-text-quaternary">
                    ·
                  </span>
                  <span className="truncate system-xs-regular text-text-tertiary">
                    {t(($) => $['studio.environmentsInUse'], usage)}
                  </span>
                </>
              )}
            </div>
            <EnvironmentDeployMenu onOpenDeployment={openDeployment} />
          </div>

          {latestVersionIsError && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-2 rounded-xl border border-state-destructive-border bg-state-destructive-hover-alt p-3"
            >
              <span
                aria-hidden
                className="i-ri-error-warning-fill size-4 shrink-0 text-text-destructive"
              />
              <p className="grow system-sm-medium text-text-destructive">
                {t(($) => $['studio.latestVersionLoadFailed'])}
              </p>
              <Button
                size="small"
                variant="secondary"
                loading={latestVersionIsRetrying}
                onClick={() => void refetchLatestVersion()}
                className="gap-1 px-2"
              >
                <span aria-hidden className="i-ri-reset-left-line size-3" />
                <span>{tCommon(($) => $['operation.retry'])}</span>
              </Button>
            </div>
          )}

          <div
            className={cn(
              'min-h-0 w-full grow overflow-y-auto',
              deployments.length > 0 ? 'overflow-x-auto' : 'overflow-x-hidden',
            )}
          >
            {showLoadingState ? (
              <LoadingPlaceholder className="h-full" />
            ) : showErrorState ? (
              <EnvironmentTableEmpty
                state="error"
                isRetrying={isRetrying}
                onRetry={() => void refetchDeployments()}
              />
            ) : showEmptyState ? (
              <EnvironmentTableEmpty state="empty" onOpenDeployment={openDeployment} />
            ) : (
              <table
                aria-labelledby="deploy-environments-title"
                className="w-full min-w-260 table-fixed border-separate border-spacing-0"
              >
                <EnvironmentTableColumns />
                <EnvironmentTableHeader />
                <tbody>
                  {deployments.map((row) => (
                    <EnvironmentRow
                      key={row.environment.id}
                      appId={appId}
                      canViewAccessPoint={canViewAccessPoint}
                      latestVersion={deployableLatestVersion}
                      row={row}
                      onOpenDeployment={openDeployment}
                      onOpenUndeploy={openUndeploy}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        <Dialog
          open={deploymentSession?.open ?? false}
          disablePointerDismissal
          onOpenChange={(open) => {
            if (!open) closeDeployment()
          }}
          onOpenChangeComplete={(open) => {
            if (!open) setDeploymentSession((session) => (session?.open ? session : undefined))
          }}
        >
          {deploymentSession && (
            <DeploymentDialogContent
              appId={appId}
              request={deploymentSession.request}
              onClose={closeDeployment}
              finalFocus={() =>
                deploymentSession.returnFocusElement?.isConnected
                  ? deploymentSession.returnFocusElement
                  : environmentsTitleRef.current
              }
            />
          )}
        </Dialog>
        <AlertDialog
          open={undeploySession?.open ?? false}
          onOpenChange={(open, eventDetails) => {
            if (open) return
            if (isUndeploying) {
              eventDetails.cancel()
              return
            }
            setUndeploySession((session) => session && { ...session, open: false })
          }}
          onOpenChangeComplete={(open) => {
            if (!open) setUndeploySession((session) => (session?.open ? session : undefined))
          }}
        >
          {undeploySession && (
            <UndeployConfirmDialogContent
              finalFocus={() =>
                undeploySession.returnFocusElement?.isConnected
                  ? undeploySession.returnFocusElement
                  : environmentsTitleRef.current
              }
              environmentName={undeploySession.deployment.environment.display_name}
              isPending={isUndeploying}
              versionName={getWorkflowVersionName(
                undeploySession.deployment.deployment?.current_version,
                tWorkflow(($) => $['versionHistory.defaultName']),
              )}
              onConfirm={() => void handleUndeploy(undeploySession.deployment)}
            />
          )}
        </AlertDialog>
      </>
    )
  },
)
