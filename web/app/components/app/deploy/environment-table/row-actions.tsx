import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentDialogRequest, OpenDeploymentDialog } from '../types'
import type { EnvironmentDeploymentAction } from '../utils/environment-deployment'
import type { DeploymentVersion } from '../utils/version'
import type { OpenUndeployDialog } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Fragment, useRef } from 'react'
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
  onOpenDeployment,
  onOpenUndeploy,
}: {
  latestVersion?: DeploymentVersion
  row: EnvironmentDeployment
  onOpenDeployment: OpenDeploymentDialog
  onOpenUndeploy: OpenUndeployDialog
}) {
  const { t } = useTranslation(['deployments'])
  const { t: tWorkflow } = useTranslation(['workflowHistory'])
  const defaultVersionName = tWorkflow(($) => $['versionHistory.defaultName'], {
    ns: 'workflowHistory',
  })
  const primaryTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const actions = getEnvironmentDeploymentActions(row, {
    deployLatestDisabled: !latestVersion,
  })
  const handleAction = (
    action: EnvironmentDeploymentAction,
    returnFocusElement: HTMLElement | null,
  ) => {
    if (action.kind === 'undeploy') {
      onOpenUndeploy(row, returnFocusElement)
      return
    }
    const request = deploymentDialogRequest(action, row, latestVersion, defaultVersionName)
    if (request) onOpenDeployment(request, returnFocusElement)
  }
  const primaryAction = actions[0]
  const moreActions = actions.slice(1)

  if (!primaryAction) return null

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        ref={primaryTriggerRef}
        size="small"
        variant="secondary"
        disabled={primaryAction.disabled}
        focusableWhenDisabled
        className="min-w-0 gap-1 px-2"
        onClick={() => handleAction(primaryAction, primaryTriggerRef.current)}
      >
        <span
          aria-hidden
          className={cn(ROW_ACTION_ICON_CLASS_NAMES[primaryAction.kind], 'size-3.5 shrink-0')}
        />
        <span className="truncate">
          {rowActionLabel(primaryAction, row, t, defaultVersionName)}
        </span>
      </Button>
      <Menu modal={false}>
        <MenuTrigger
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
        <MenuContent align="end" className="w-50">
          {moreActions.map((action, index) => (
            <Fragment key={action.kind}>
              {action.kind === 'undeploy' && index > 0 && <MenuSeparator />}
              <MenuItem
                disabled={action.disabled}
                className="gap-2 px-2"
                onClick={() => {
                  handleAction(action, menuTriggerRef.current)
                }}
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
              </MenuItem>
            </Fragment>
          ))}
        </MenuContent>
      </Menu>
    </div>
  )
}
