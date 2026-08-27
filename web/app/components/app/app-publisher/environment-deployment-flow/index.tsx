'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import type { DeploymentVersion } from '@/app/components/app/deploy/utils/version'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { EnvironmentDeploymentFlow } from '@/app/components/app/deploy/shared/environment-deployment-flow'
import Loading from '@/app/components/base/loading'
import {
  publisherEnvironmentDeploymentPollingAtom,
  startPublisherEnvironmentDeploymentPollingAtom,
} from '../state'
import { PublisherEnvironmentActionsSection } from './actions-section'
import { PublisherEnvironmentSummarySection } from './summary-section'

type PublisherEnvironmentFlowProps = {
  appId?: string
  deployment?: EnvironmentDeployment
  environmentId: string
  environmentName: string
  environmentTabs: ReactNode
  isEnvironmentInUse: boolean
  isDeploymentError: boolean
  isDeploymentLoading: boolean
  latestVersion?: DeploymentVersion | null
  onGoToPublish: () => void
}

export function PublisherEnvironmentFlow({
  appId,
  deployment,
  environmentId,
  environmentName,
  environmentTabs,
  isEnvironmentInUse,
  isDeploymentError,
  isDeploymentLoading,
  latestVersion,
  onGoToPublish,
}: PublisherEnvironmentFlowProps) {
  const { t } = useTranslation()
  const deploymentPolling = useAtomValue(publisherEnvironmentDeploymentPollingAtom)
  const startDeploymentPolling = useSetAtom(startPublisherEnvironmentDeploymentPollingAtom)

  if (isDeploymentLoading || (isDeploymentError && !deployment)) {
    return (
      <div aria-busy={isDeploymentLoading} className="flex min-h-40 flex-col gap-3 p-4">
        {environmentTabs}
        {isDeploymentLoading ? (
          <Loading className="flex-1" />
        ) : (
          <div
            role="alert"
            className="flex flex-1 items-center justify-center system-sm-regular text-text-tertiary"
          >
            {t(($) => $['common.loadFailed'], { ns: 'deployments' })}
          </div>
        )}
      </div>
    )
  }

  return (
    <EnvironmentDeploymentFlow
      appId={appId}
      deployment={deployment}
      disabled={deploymentPolling?.environmentId === environmentId}
      environmentId={environmentId}
      environmentName={environmentName}
      onDeploymentStarted={(operationId) => {
        startDeploymentPolling({ environmentId, operationId })
      }}
    >
      {({ deploymentActionsDisabled, deployVersion, showVersionSelection }) => (
        <div>
          <PublisherEnvironmentSummarySection
            deployment={deployment}
            deploymentActionsDisabled={deploymentActionsDisabled}
            environmentTabs={environmentTabs}
            isEnvironmentInUse={isEnvironmentInUse}
            latestVersion={latestVersion}
            onDeployLatest={() => {
              if (latestVersion) deployVersion(latestVersion)
            }}
            onDeployOtherVersion={showVersionSelection}
            onGoToPublish={onGoToPublish}
            onShowAllVersions={showVersionSelection}
          />
          <PublisherEnvironmentActionsSection
            appId={appId}
            deployment={deployment}
            environmentId={environmentId}
          />
        </div>
      )}
    </EnvironmentDeploymentFlow>
  )
}
