import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { EnvironmentDeploymentAction } from '../state'
import type { UndeployHandler } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Fragment, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'
import { getEnvironmentDeploymentActions } from '../state'
import { UndeployConfirmDialog } from './undeploy-confirm-dialog'

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

export function EnvironmentRowActions({
  row,
  onChangeVersion,
  onDeployLatest,
  onRedeploy,
  onUndeploy,
}: {
  row: EnvironmentDeployment
  onChangeVersion?: (deployment: EnvironmentDeployment) => void
  onDeployLatest?: (deployment: EnvironmentDeployment) => void
  onRedeploy?: (deployment: EnvironmentDeployment) => void
  onUndeploy?: UndeployHandler
}) {
  const { t } = useTranslation('deployments')
  const { t: tWorkflow } = useTranslation('workflow')
  const defaultVersionName = tWorkflow(($) => $['versionHistory.defaultName'])
  const currentVersionName = getWorkflowVersionName(
    row.deployment?.current_version,
    defaultVersionName,
  )
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const [isUndeploying, setIsUndeploying] = useState(false)
  const actions = getEnvironmentDeploymentActions(row)
  const primaryAction = actions[0]
  const moreActions = actions.slice(1)

  const handleAction = useCallback(
    (action: EnvironmentDeploymentAction) => {
      if (action.disabled) return

      switch (action.kind) {
        case 'changeVersion':
          onChangeVersion?.(row)
          break
        case 'deployLatest':
          onDeployLatest?.(row)
          break
        case 'redeploy':
        case 'retry':
          onRedeploy?.(row)
          break
        case 'undeploy':
          setShowUndeployConfirm(true)
          break
      }
    },
    [onChangeVersion, onDeployLatest, onRedeploy, row],
  )

  const handleUndeploy = useCallback(async () => {
    if (isUndeploying) return

    setIsUndeploying(true)
    try {
      await onUndeploy?.(row)
      setShowUndeployConfirm(false)
    } catch {
      // The request layer reports the error; keep the dialog open so the user can retry.
    } finally {
      setIsUndeploying(false)
    }
  }, [isUndeploying, onUndeploy, row])

  if (!primaryAction) return null

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Button
          size="small"
          variant="secondary"
          disabled={primaryAction.disabled}
          onClick={() => handleAction(primaryAction)}
          className="min-w-0 gap-1 px-2"
        >
          <span
            aria-hidden
            className={cn(ROW_ACTION_ICON_CLASS_NAMES[primaryAction.kind], 'size-3.5 shrink-0')}
          />
          <span className="truncate">
            {rowActionLabel(primaryAction, row, t, defaultVersionName)}
          </span>
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <IconButton
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
                  disabled={action.disabled}
                  className="gap-2 px-2"
                  onClick={() => handleAction(action)}
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
      <UndeployConfirmDialog
        environmentName={row.environment.display_name}
        isPending={isUndeploying}
        open={showUndeployConfirm}
        versionName={currentVersionName}
        onConfirm={handleUndeploy}
        onOpenChange={setShowUndeployConfirm}
      />
    </>
  )
}
