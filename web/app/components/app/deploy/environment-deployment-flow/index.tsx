'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import type { DeploymentVersion } from '../version'
import { useState } from 'react'
import { DeploymentConfiguration } from '../deployment-dialog/deployment-configuration'
import { EmbeddedVersionSelection } from '../deployment-dialog/version-selection'
import { AppDeployStateBoundary, isEnvironmentDeploymentInProgress } from '../state'

type EnvironmentDeploymentFlowView = 'configuration' | 'overview' | 'versions'

type EnvironmentDeploymentFlowActions = {
  deploymentActionsDisabled: boolean
  deployVersion: (version: DeploymentVersion) => void
  showVersionSelection: () => void
}

type EnvironmentDeploymentFlowProps = {
  appId?: string
  children: (actions: EnvironmentDeploymentFlowActions) => ReactNode
  deployment?: EnvironmentDeployment
  disabled?: boolean
  environmentId: string
  environmentName: string
  onDeploymentStarted: (operationId: string) => void
}

function EnvironmentDeploymentFlowContent({
  appId,
  children,
  deployment,
  disabled = false,
  environmentId,
  environmentName,
  onDeploymentStarted,
}: EnvironmentDeploymentFlowProps) {
  const [view, setView] = useState<EnvironmentDeploymentFlowView>('overview')
  const [selectedVersion, setSelectedVersion] = useState<DeploymentVersion>()
  const currentVersionId = deployment?.deployment?.current_version?.id
  const deploymentActionsDisabled = disabled || isEnvironmentDeploymentInProgress(deployment)
  const request = {
    currentVersionId,
    environment: environmentName,
    environmentId,
    kind: 'deploy' as const,
  }

  const showVersionSelection = () => {
    if (deploymentActionsDisabled) return
    setView('versions')
  }

  const deployVersion = (version: DeploymentVersion) => {
    if (deploymentActionsDisabled) return
    setSelectedVersion(version)
    setView('configuration')
  }

  if (view === 'configuration' && selectedVersion) {
    return (
      <DeploymentConfiguration
        appId={appId}
        disabled={deploymentActionsDisabled}
        embedded
        invalidateAppEnvironmentsOnSuccess={false}
        request={request}
        version={selectedVersion}
        onBack={showVersionSelection}
        onClose={() => setView('overview')}
        onDeploymentStarted={onDeploymentStarted}
      />
    )
  }

  if (view === 'versions') {
    return (
      <EmbeddedVersionSelection
        disabled={deploymentActionsDisabled}
        request={request}
        onBack={() => setView('overview')}
        onSelect={deployVersion}
      />
    )
  }

  return children({
    deploymentActionsDisabled,
    deployVersion,
    showVersionSelection,
  })
}

export function EnvironmentDeploymentFlow(props: EnvironmentDeploymentFlowProps) {
  if (!props.appId) return <EnvironmentDeploymentFlowContent {...props} />

  return (
    <AppDeployStateBoundary appId={props.appId}>
      <EnvironmentDeploymentFlowContent {...props} />
    </AppDeployStateBoundary>
  )
}
