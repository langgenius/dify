'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { DeploymentDialogPayload } from '../types'
import type { UndeployDialogPayload, UndeployHandler } from './types'
import { AlertDialog, createAlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useRefWithInit } from '@langgenius/dify-ui/use-ref-with-init'
import { useAtomValue } from 'jotai'
import dynamic from 'next/dynamic'
import { memo, useRef, useState } from 'react'
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

const DeploymentDialogSession = dynamic(() =>
  import('../deployment-dialog').then((module) => module.DeploymentDialogSession),
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
    const dialogTitleRef = useRef<HTMLHeadingElement | null>(null)
    const deploymentActionsRef = useRef<DialogActions | null>(null)
    const undeployActionsRef = useRef<AlertDialogActions | null>(null)
    // The detached undeploy Root stays outside the deployment Root's nested-dialog context.
    const undeployDialogHandle = useRefWithInit(() =>
      createAlertDialogHandle<UndeployDialogPayload>(),
    ).current
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
        undeployActionsRef.current?.close()
      } catch {
        // The request layer reports the error; keep the dialog open so the user can retry.
      } finally {
        setIsUndeploying(false)
      }
    }

    return (
      <>
        <Dialog<DeploymentDialogPayload> actionsRef={deploymentActionsRef} disablePointerDismissal>
          {({ payload }) => (
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
                  <EnvironmentDeployMenu />
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
                    <EnvironmentTableEmpty state="empty" />
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
                            undeployDialogHandle={undeployDialogHandle}
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
              <DialogContent
                initialFocus={dialogTitleRef}
                finalFocus={() =>
                  payload?.returnFocusRef.current?.isConnected
                    ? payload.returnFocusRef.current
                    : environmentsTitleRef.current
                }
                className="max-h-[min(44rem,calc(100dvh-32px))]"
              >
                {payload && (
                  <DeploymentDialogSession
                    key={`${payload.request.kind}-${payload.request.environmentId}-${payload.request.currentVersionId ?? 'none'}-${
                      'initialVersion' in payload.request
                        ? payload.request.initialVersion.id
                        : 'none'
                    }`}
                    appId={appId}
                    menuActionsRef={payload.menuActionsRef}
                    titleRef={dialogTitleRef}
                    request={payload.request}
                    onClose={() => deploymentActionsRef.current?.close()}
                  />
                )}
              </DialogContent>
            </>
          )}
        </Dialog>
        <AlertDialog<UndeployDialogPayload>
          handle={undeployDialogHandle}
          actionsRef={undeployActionsRef}
          onOpenChange={(open, eventDetails) => {
            if (!open && isUndeploying && eventDetails.reason !== 'imperative-action')
              eventDetails.cancel()
          }}
        >
          {({ payload }) =>
            payload && (
              <UndeployConfirmDialogContent
                menuActionsRef={payload.menuActionsRef}
                finalFocus={() =>
                  payload.returnFocusRef.current?.isConnected
                    ? payload.returnFocusRef.current
                    : environmentsTitleRef.current
                }
                environmentName={payload.deployment.environment.display_name}
                isPending={isUndeploying}
                versionName={getWorkflowVersionName(
                  payload.deployment.deployment?.current_version,
                  tWorkflow(($) => $['versionHistory.defaultName']),
                )}
                onConfirm={() => void handleUndeploy(payload.deployment)}
              />
            )
          }
        </AlertDialog>
      </>
    )
  },
)
