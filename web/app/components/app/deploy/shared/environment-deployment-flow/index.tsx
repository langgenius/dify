'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import type { DeploymentVersion } from '../../utils/version'
import { useEffect, useState } from 'react'
import { AppDeployStateBoundary } from '../../state'
import { shouldPollEnvironmentDeployment } from '../../utils/environment-deployment'
import { DeploymentConfiguration } from '../deployment-configuration'
import { EmbeddedVersionSelection } from '../version-selection'

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
  onConfigurationOpenChange?: (open: boolean) => void
  onDeploymentStarted: (operationId: string) => void
}

function EnvironmentDeploymentFlowContent({
  appId,
  children,
  deployment,
  disabled = false,
  environmentId,
  environmentName,
  onConfigurationOpenChange,
  onDeploymentStarted,
}: EnvironmentDeploymentFlowProps) {
  const [view, setView] = useState<EnvironmentDeploymentFlowView>('overview')
  const [selectedVersion, setSelectedVersion] = useState<DeploymentVersion>()
  const currentVersionId = deployment?.deployment?.current_version?.id
  const deploymentActionsDisabled = disabled || shouldPollEnvironmentDeployment(deployment)
  const request = {
    currentVersionId,
    environment: environmentName,
    environmentId,
    kind: 'deploy' as const,
  }

  useEffect(
    () => () => {
      onConfigurationOpenChange?.(false)
    },
    [onConfigurationOpenChange],
  )

  const changeView = (nextView: EnvironmentDeploymentFlowView) => {
    setView(nextView)
    onConfigurationOpenChange?.(nextView === 'configuration')
  }

  const showVersionSelection = () => {
    if (deploymentActionsDisabled) return
    changeView('versions')
  }

  const deployVersion = (version: DeploymentVersion) => {
    if (deploymentActionsDisabled) return
    setSelectedVersion(version)
    changeView('configuration')
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
        onClose={() => changeView('overview')}
        onDeploymentStarted={onDeploymentStarted}
      />
    )
  }

  if (view === 'versions') {
    return (
      <EmbeddedVersionSelection
        disabled={deploymentActionsDisabled}
        request={request}
        onBack={() => changeView('overview')}
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
