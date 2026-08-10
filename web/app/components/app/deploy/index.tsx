'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentDialogRequest } from './deployment-dialog/types'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { userProfileIdAtom } from '@/context/account-state'
import { useDocLink } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { BuiltInEnvironmentCard } from './built-in-environment-card'
import { DeploymentDialog } from './deployment-dialog'
import { EnvironmentTable } from './environment-table'
import { AppDeployStateBoundary, latestAppWorkflowVersionAtom } from './state'
import { useRefreshAppEnvironmentsAfterDeploymentPolling } from './use-refresh-app-environments-after-deployment-polling'
import { useUndeployWorkflow } from './use-undeploy-workflow'
import { toDeploymentVersion } from './version'

function AppDeployContent({ appId }: { appId: string }) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const { t: tWorkflow } = useTranslation('workflow')
  const docLink = useDocLink()
  // TODO: Replace useDocLink with the EE-specific generator for the versioned
  // `en/3.13.x/use/deploy/overview.mdx` URL once it is available.
  const deployOverviewDocUrl = docLink('/use/deploy/overview' as DocPathWithoutLang)
  const [deploymentRequest, setDeploymentRequest] = useState<DeploymentDialogRequest>()
  const latestVersion = useAtomValue(latestAppWorkflowVersionAtom)
  useRefreshAppEnvironmentsAfterDeploymentPolling(appId)
  const undeployWorkflow = useUndeployWorkflow(appId)

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
      initialVersion: toDeploymentVersion(
        version,
        tWorkflow(($) => $['versionHistory.defaultName']),
      ),
      kind: 'redeploy',
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
              href={deployOverviewDocUrl}
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
            appId={appId}
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
            onUndeploy={undeployWorkflow}
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

  if (!appDetail) return <Loading type="app" />

  const canDeploy = getAppACLCapabilities(appDetail.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail.maintainer,
    workspacePermissionKeys,
  }).canDeploy

  if (appDetail.mode !== AppModeEnum.WORKFLOW || !canDeploy) return null

  return (
    <AppDeployStateBoundary appId={appDetail.id}>
      <AppDeployContent appId={appDetail.id} />
    </AppDeployStateBoundary>
  )
}
