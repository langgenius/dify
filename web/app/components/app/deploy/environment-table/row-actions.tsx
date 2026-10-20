import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { DropdownMenuActions } from '@langgenius/dify-ui/dropdown-menu'
import type { DeploymentDialogPayload, DeploymentDialogRequest } from '../types'
import type { EnvironmentDeploymentAction } from '../utils/environment-deployment'
import type { DeploymentVersion } from '../utils/version'
import type { UndeployDialogPayload } from './types'
import { AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Fragment, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'
import { getEnvironmentDeploymentActions } from '../utils/environment-deployment'
import { toDeploymentVersion } from '../utils/version'

function rowActionLabel(
  action: EnvironmentDeploymentAction,
  row: EnvironmentDeployment,
  t: ReturnType<typeof useTranslation<'deployments'>>['t'],
  defaultVersionName: string,
) {
  switch (action.kind) {
    case 'changeVersion':
      return t(($) => $['studio.changeVersion'])
    case 'deployLatest':
      return t(($) => $['studio.deployLatest'])
    case 'redeploy':
      return t(($) => $['deployTab.redeploy'])
    case 'retry': {
      const operation = row.deployment?.latest_operation
      const version = getWorkflowVersionName(
        operation?.target_version ?? row.deployment?.current_version,
        defaultVersionName,
      )
      return t(($) => $['studio.retryVersion'], { version })
    }
    case 'undeploy':
      return t(($) => $['deployTab.undeploy'])
  }
}

const ROW_ACTION_ICON_CLASS_NAMES: Record<EnvironmentDeploymentAction['kind'], string> = {
  changeVersion: 'i-ri-repeat-line',
  deployLatest: 'i-custom-vender-deploy-rocket',
  redeploy: 'i-ri-reset-left-line',
  retry: 'i-ri-reset-left-line',
  undeploy: 'i-ri-logout-circle-r-line',
}

function deploymentDialogRequest(
  action: EnvironmentDeploymentAction,
  row: EnvironmentDeployment,
  latestVersion: DeploymentVersion | undefined,
  defaultVersionName: string,
): DeploymentDialogRequest | undefined {
  const request = {
    currentVersionId: row.deployment?.current_version?.id,
    environment: row.environment.display_name,
    environmentId: row.environment.id,
  }

  switch (action.kind) {
    case 'changeVersion':
      return { ...request, kind: 'changeVersion' }
    case 'deployLatest':
      return latestVersion
        ? { ...request, initialVersion: latestVersion, kind: 'deployLatest' }
        : undefined
    case 'redeploy':
    case 'retry': {
      const version =
        row.deployment?.latest_operation?.target_version ?? row.deployment?.current_version
      return version
        ? {
            ...request,
            initialVersion: toDeploymentVersion(version, defaultVersionName),
            kind: 'redeploy',
          }
        : { ...request, kind: 'changeVersion' }
    }
    case 'undeploy':
      return undefined
  }
}

export function EnvironmentRowActions({
  latestVersion,
  row,
  undeployDialogHandle,
}: {
  latestVersion?: DeploymentVersion
  row: EnvironmentDeployment
  undeployDialogHandle: AlertDialogHandle<UndeployDialogPayload>
}) {
  const { t } = useTranslation(['deployments'])
  const { t: tWorkflow } = useTranslation(['workflowHistory'])
  const defaultVersionName = tWorkflow(($) => $['versionHistory.defaultName'], {
    ns: 'workflowHistory',
  })
  const primaryTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuActionsRef = useRef<DropdownMenuActions | null>(null)
  // Keep Trigger payloads stable while the Dialog Root rerenders its child function.
  const actions = useMemo(
    () =>
      getEnvironmentDeploymentActions(row, {
        deployLatestDisabled: !latestVersion,
      }).map((action, index) => {
        const request = deploymentDialogRequest(action, row, latestVersion, defaultVersionName)
        return {
          ...action,
          dialogPayload: request
            ? ({
                menuActionsRef: index === 0 ? undefined : menuActionsRef,
                request,
                returnFocusRef: index === 0 ? primaryTriggerRef : menuTriggerRef,
              } satisfies DeploymentDialogPayload)
            : undefined,
        }
      }),
    [defaultVersionName, latestVersion, row],
  )
  const undeployPayload = useMemo<UndeployDialogPayload>(
    () => ({ deployment: row, menuActionsRef, returnFocusRef: menuTriggerRef }),
    [row],
  )
  const primaryAction = actions[0]
  const moreActions = actions.slice(1)

  if (!primaryAction) return null

  return (
    <div className="flex items-center justify-end gap-1">
      <DialogTrigger<DeploymentDialogPayload>
        disabled={primaryAction.disabled}
        payload={primaryAction.dialogPayload}
        render={
          <Button
            ref={primaryTriggerRef}
            size="small"
            variant="secondary"
            disabled={primaryAction.disabled}
            focusableWhenDisabled
            className="min-w-0 gap-1 px-2"
          />
        }
      >
        <span
          aria-hidden
          className={cn(ROW_ACTION_ICON_CLASS_NAMES[primaryAction.kind], 'size-3.5 shrink-0')}
        />
        <span className="truncate">
          {rowActionLabel(primaryAction, row, t, defaultVersionName)}
        </span>
      </DialogTrigger>
      <DropdownMenu actionsRef={menuActionsRef} modal={false}>
        <DropdownMenuTrigger
          render={
            <IconButton
              ref={menuTriggerRef}
              size="md"
              variant="secondary"
              aria-label={`${row.environment.display_name} · ${t(($) => $['deployTab.moreActions'])}`}
              className="shrink-0"
            >
              <span aria-hidden className="i-ri-more-fill size-4" />
            </IconButton>
          }
        />
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-50">
          {moreActions.map((action, index) => (
            <Fragment key={action.kind}>
              {action.kind === 'undeploy' && index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                closeOnClick={false}
                disabled={action.disabled}
                className="gap-2 px-2"
                render={
                  action.kind === 'undeploy' ? (
                    <AlertDialogTrigger<UndeployDialogPayload>
                      handle={undeployDialogHandle}
                      nativeButton={false}
                      disabled={action.disabled}
                      payload={undeployPayload}
                      render={<div />}
                    />
                  ) : (
                    <DialogTrigger<DeploymentDialogPayload>
                      nativeButton={false}
                      disabled={action.disabled}
                      payload={action.dialogPayload}
                      render={<div />}
                    />
                  )
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    ROW_ACTION_ICON_CLASS_NAMES[action.kind],
                    'size-4 shrink-0 text-text-secondary',
                  )}
                />
                <span className="min-w-0 flex-1 truncate system-md-regular text-text-secondary">
                  {rowActionLabel(action, row, t, defaultVersionName)}
                </span>
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
