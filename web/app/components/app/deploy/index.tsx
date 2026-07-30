'use client'

import type {
  EnvironmentDeployment,
  WorkflowVersion,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentDialogRequest } from './deployment-dialog/types'
import type { MockVersion } from './mock-data'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { BuiltInEnvironmentCard } from './built-in-environment-card'
import { DeploymentDialog } from './deployment-dialog'
import { EnvironmentTable } from './environment-table'
import { BUILT_IN_ENVIRONMENT, MOCK_PUBLISHED_VERSIONS } from './mock-data'
import { AppDeployStateBoundary, getWorkflowVersionName } from './state'

function toDialogVersion(version: WorkflowVersion): MockVersion {
  return {
    description: version.marked_comment || undefined,
    name: getWorkflowVersionName(version) ?? version.version,
  }
}

export default function AppDeploy() {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const [deploymentRequest, setDeploymentRequest] = useState<DeploymentDialogRequest>()
  const appDetail = useAppStore((state) => state.appDetail)
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canDeploy = getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  }).canDeploy
  const latestVersion = MOCK_PUBLISHED_VERSIONS.find((version) => version.latest)

  const handleRedeploy = (deployment: EnvironmentDeployment) => {
    const deploymentState = deployment.deployment
    const version =
      deploymentState?.latest_operation?.target_version ?? deploymentState?.current_version
    const environment = deployment.environment.display_name

    if (!version) {
      setDeploymentRequest({
        environment,
        kind: 'changeVersion',
      })
      return
    }

    setDeploymentRequest({
      currentVersion: getWorkflowVersionName(deploymentState?.current_version),
      environment,
      initialVersion: toDialogVersion(version),
      kind: 'redeploy',
    })
  }

  if (appDetail?.mode !== AppModeEnum.WORKFLOW || !canDeploy) return null

  return (
    <AppDeployStateBoundary appId={appDetail.id}>
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
                currentVersion: BUILT_IN_ENVIRONMENT.version.name,
                environment: environment.display_name,
                kind: 'deploy',
              })
            }
            onChangeVersion={(deployment) =>
              setDeploymentRequest({
                currentVersion: getWorkflowVersionName(deployment.deployment?.current_version),
                environment: deployment.environment.display_name,
                kind: 'changeVersion',
              })
            }
            onDeployLatest={(deployment) => {
              if (!latestVersion) return

              setDeploymentRequest({
                currentVersion: getWorkflowVersionName(deployment.deployment?.current_version),
                environment: deployment.environment.display_name,
                initialVersion: latestVersion,
                kind: 'deployLatest',
              })
            }}
            onRedeploy={handleRedeploy}
            onUndeploy={() => {}}
          />
        </div>
      </main>
      <DeploymentDialog
        request={deploymentRequest}
        onClose={() => setDeploymentRequest(undefined)}
      />
    </AppDeployStateBoundary>
  )
}
