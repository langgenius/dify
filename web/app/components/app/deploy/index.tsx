'use client'

import type {
  EnvironmentDeployment,
  WorkflowVersion,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentDialogRequest } from './deployment-dialog/types'
import type { DeploymentVersion } from './version'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { BuiltInEnvironmentCard } from './built-in-environment-card'
import { DeploymentDialog } from './deployment-dialog'
import { EnvironmentTable } from './environment-table'
import {
  AppDeployStateBoundary,
  getWorkflowVersionName,
  latestAppWorkflowVersionAtom,
} from './state'
import { useRefreshAppEnvironmentsAfterDeploymentPolling } from './use-refresh-app-environments-after-deployment-polling'

function toDialogVersion(version: WorkflowVersion): DeploymentVersion {
  return {
    description: version.marked_comment || undefined,
    id: version.id,
    name: getWorkflowVersionName(version) ?? version.version,
  }
}

function AppDeployContent({ appId }: { appId: string }) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const [deploymentRequest, setDeploymentRequest] = useState<DeploymentDialogRequest>()
  const latestVersion = useAtomValue(latestAppWorkflowVersionAtom)
  const queryClient = useQueryClient()
  useRefreshAppEnvironmentsAfterDeploymentPolling(appId)
  const { mutateAsync: undeployWorkflow } = useMutation(
    consoleQuery.enterprise.appDeploy.deploymentService.undeployWorkflow.mutationOptions({
      onSuccess: async () => {
        const appEnvironmentsQuery =
          consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
            input: {
              params: {
                app_id: appId,
              },
            },
          })
        const environmentDeploymentsQuery =
          consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
            {
              input: {
                params: {
                  app_id: appId,
                },
              },
            },
          )

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: appEnvironmentsQuery.queryKey }),
          queryClient.invalidateQueries({ queryKey: environmentDeploymentsQuery.queryKey }),
        ])
      },
    }),
  )

  const handleRedeploy = (deployment: EnvironmentDeployment) => {
    const deploymentState = deployment.deployment
    const version =
      deploymentState?.latest_operation?.target_version ?? deploymentState?.current_version
    const environment = deployment.environment.display_name
    const environmentId = deployment.environment.id

    if (!version) {
      setDeploymentRequest({
        environment,
        environmentId,
        kind: 'changeVersion',
      })
      return
    }

    setDeploymentRequest({
      currentVersionId: deploymentState?.current_version?.id,
      environment,
      environmentId,
      initialVersion: toDialogVersion(version),
      kind: 'redeploy',
    })
  }

  const handleUndeploy = async (deployment: EnvironmentDeployment) => {
    const workflowId = deployment.deployment?.current_version?.id
    if (!workflowId) return

    await undeployWorkflow({
      params: {
        app_id: appId,
        environment_id: deployment.environment.id,
        workflow_id: workflowId,
      },
    })
  }

  return (
    <>
      <main className="flex h-full flex-col bg-components-panel-bg">
        <header className="shrink-0 px-6 pt-3 pb-2">
          <h1 className="title-xl-semi-bold text-text-primary">
            {tCommon(($) => $['appMenus.deploy'])}
          </h1>
          <p className="flex items-center gap-x-1 system-xs-regular text-text-tertiary">
            <span>{t(($) => $['studio.description'])}</span>
            <a
              href="https://docs.dify.ai/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-text-accent hover:underline focus-visible:ring-1 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              {tCommon(($) => $['operation.learnMore'])}
              <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
            </a>
          </p>
        </header>

        <div className="flex min-h-0 grow flex-col gap-4 px-6 py-2">
          <BuiltInEnvironmentCard />
          <EnvironmentTable
            onDeployToEnvironment={(environment) =>
              setDeploymentRequest({
                environment: environment.display_name,
                environmentId: environment.id,
                kind: 'deploy',
              })
            }
            onChangeVersion={(deployment) =>
              setDeploymentRequest({
                currentVersionId: deployment.deployment?.current_version?.id,
                environment: deployment.environment.display_name,
                environmentId: deployment.environment.id,
                kind: 'changeVersion',
              })
            }
            onDeployLatest={(deployment) => {
              if (!latestVersion) return

              setDeploymentRequest({
                currentVersionId: deployment.deployment?.current_version?.id,
                environment: deployment.environment.display_name,
                environmentId: deployment.environment.id,
                initialVersion: latestVersion,
                kind: 'deployLatest',
              })
            }}
            onRedeploy={handleRedeploy}
            onUndeploy={handleUndeploy}
          />
        </div>
      </main>
      <DeploymentDialog
        appId={appId}
        request={deploymentRequest}
        onClose={() => setDeploymentRequest(undefined)}
      />
    </>
  )
}

export default function AppDeploy() {
  const appDetail = useAppStore((state) => state.appDetail)
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canDeploy = getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  }).canDeploy

  if (appDetail?.mode !== AppModeEnum.WORKFLOW || !canDeploy) return null

  return (
    <AppDeployStateBoundary appId={appDetail.id}>
      <AppDeployContent appId={appDetail.id} />
    </AppDeployStateBoundary>
  )
}
