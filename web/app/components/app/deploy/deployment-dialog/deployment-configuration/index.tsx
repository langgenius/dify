'use client'
import type { DeploymentVersion } from '../../version'
import type { DeploymentDialogRequest } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogClose, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { useDeployWorkflow } from '../../use-deploy-workflow'
import { DeploymentConfigurationContent } from './content'
import { useDeploymentConfigurationQueries } from './use-deployment-configuration-queries'
import { useDeploymentConfigurationValues } from './use-deployment-configuration-values'
import { workflowDeploymentInput } from './workflow-deployment-input'

export function DeploymentConfiguration({
  appId,
  disabled = false,
  embedded = false,
  invalidateAppEnvironmentsOnSuccess = true,
  request,
  version,
  onBack,
  onClose,
  onDeploymentStarted,
}: {
  appId?: string
  disabled?: boolean
  embedded?: boolean
  invalidateAppEnvironmentsOnSuccess?: boolean
  request: DeploymentDialogRequest
  version: DeploymentVersion
  onBack?: () => void
  onClose: () => void
  onDeploymentStarted?: (operationId: string) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const [configurationValues, setConfigurationValues] = useDeploymentConfigurationValues()
  const queryState = useDeploymentConfigurationQueries({
    appId,
    environmentId: request.environmentId,
    workflowId: version.id,
  })
  const deploymentInput = queryState.deploymentOptions
    ? workflowDeploymentInput(queryState.deploymentOptions, configurationValues)
    : undefined
  const deployMutation = useDeployWorkflow({
    appId,
    invalidateAppEnvironmentsOnSuccess,
    onSuccess: (response) => {
      onDeploymentStarted?.(response.operation.id)
      onClose()
    },
  })
  const canDeploy =
    Boolean(appId) &&
    !disabled &&
    queryState.canDeploy &&
    Boolean(deploymentInput) &&
    !deployMutation.isPending

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (!appId || !canDeploy || !deploymentInput) return

        deployMutation.mutate({
          body: deploymentInput,
          params: {
            app_id: appId,
            environment_id: request.environmentId,
            workflow_id: version.id,
          },
        })
      }}
    >
      {!embedded && (
        <DialogClose
          render={
            <IconButton
              aria-label={tCommon(($) => $['operation.close'])}
              size="lg"
              className="absolute top-5 right-5"
              type="button"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
      )}
      <header className={cn('shrink-0', embedded ? 'px-3 pt-3.5 pb-1' : 'px-5 pt-5 pr-14 pb-1')}>
        {onBack && (
          <Button
            type="button"
            size="small"
            variant="ghost-accent"
            className="-ml-1 h-6 gap-1 px-1 system-xs-semibold-uppercase"
            onClick={onBack}
          >
            <span aria-hidden className="i-ri-arrow-left-line size-4" />
            {tCommon(($) => $['operation.back'])}
          </Button>
        )}
        {embedded ? (
          <h2 className="mt-0.5 px-1 system-xl-semibold text-text-primary">
            {t(($) => $['studio.deployConfiguration'])}
          </h2>
        ) : (
          <DialogTitle className="mt-0.5 px-1 title-2xl-semi-bold text-text-primary">
            {t(($) => $['studio.deployConfiguration'])}
          </DialogTitle>
        )}
      </header>

      <DeploymentConfigurationContent
        compact={embedded}
        onValuesChange={setConfigurationValues}
        queryState={queryState}
        request={request}
        values={configurationValues}
        version={version}
      />

      <footer
        className={cn(
          'flex shrink-0 justify-end gap-2',
          embedded ? 'px-4 pt-2 pb-4' : 'px-6 pt-5 pb-6',
        )}
      >
        <Button type="button" variant="secondary" onClick={onClose}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canDeploy}
          loading={deployMutation.isPending}
        >
          {tCommon(($) => $['appMenus.deploy'])}
        </Button>
      </footer>
    </form>
  )
}
