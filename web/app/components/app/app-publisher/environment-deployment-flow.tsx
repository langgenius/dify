'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import type { DeploymentVersion } from '@/app/components/app/deploy/version'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeploymentConfigurationContent } from '@/app/components/app/deploy/deployment-dialog/deployment-configuration'
import { useDeploymentConfigurationQueries } from '@/app/components/app/deploy/deployment-dialog/use-deployment-configuration-queries'
import { useDeploymentConfigurationValues } from '@/app/components/app/deploy/deployment-dialog/use-deployment-configuration-values'
import { VersionChoice } from '@/app/components/app/deploy/deployment-dialog/version-selection'
import { workflowDeploymentInput } from '@/app/components/app/deploy/deployment-dialog/workflow-deployment-input'
import { useInfiniteScroll } from '@/app/components/app/deploy/hooks/use-infinite-scroll'
import {
  AppDeployStateBoundary,
  appWorkflowVersionsAtom,
  appWorkflowVersionsErrorAtom,
  appWorkflowVersionsFetchNextPageAtom,
  appWorkflowVersionsHasNextPageAtom,
  appWorkflowVersionsIsFetchingAtom,
  appWorkflowVersionsIsFetchingNextPageAtom,
  appWorkflowVersionsIsLoadingAtom,
  isEnvironmentDeploymentInProgress,
} from '@/app/components/app/deploy/state'
import { useDeployWorkflow } from '@/app/components/app/deploy/use-deploy-workflow'
import {
  PublisherEnvironmentActionsSection,
  PublisherEnvironmentSummarySection,
} from './environment-sections'
import {
  publisherEnvironmentDeploymentPollingAtom,
  startPublisherEnvironmentDeploymentPollingAtom,
} from './state'

type PublisherEnvironmentView = 'configuration' | 'publisher' | 'versions'

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

function PublisherBackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('common')

  return (
    <Button
      type="button"
      size="small"
      variant="ghost-accent"
      className="-ml-1 h-6 gap-1 px-1 system-xs-semibold-uppercase"
      onClick={onClick}
    >
      <span aria-hidden className="i-ri-arrow-left-line size-4" />
      {t(($) => $['operation.back'])}
    </Button>
  )
}

function PublisherVersionSelection({
  currentVersionId,
  disabled,
  environmentName,
  onBack,
  onSelect,
}: {
  currentVersionId?: string
  disabled: boolean
  environmentName: string
  onBack: () => void
  onSelect: (version: DeploymentVersion) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const versions = useAtomValue(appWorkflowVersionsAtom)
  const versionsError = useAtomValue(appWorkflowVersionsErrorAtom)
  const fetchNextPage = useAtomValue(appWorkflowVersionsFetchNextPageAtom)
  const hasNextPage = useAtomValue(appWorkflowVersionsHasNextPageAtom)
  const isFetching = useAtomValue(appWorkflowVersionsIsFetchingAtom)
  const isFetchingNextPage = useAtomValue(appWorkflowVersionsIsFetchingNextPageAtom)
  const isLoading = useAtomValue(appWorkflowVersionsIsLoadingAtom)
  const { rootRef, sentinelRef } = useInfiniteScroll<HTMLDivElement>({
    error: versionsError,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
  })

  return (
    <div className="flex h-133 max-h-[calc(100dvh-32px)] min-h-0 flex-none flex-col">
      <header className="shrink-0 px-3 pt-3.5 pb-1">
        <PublisherBackButton onClick={onBack} />
        <h2 className="mt-0.5 px-1 system-xl-semibold text-text-primary">
          {t(($) => $['versions.deployTo'], { name: environmentName })}
        </h2>
        <p className="mt-0.5 px-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.chooseVersionToDeploy'])}
        </p>
      </header>
      <div ref={rootRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-px">
          {versions.map((version) => (
            <VersionChoice
              key={version.id}
              version={version}
              current={version.id === currentVersionId}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </div>
        {isLoading && (
          <div
            role="status"
            aria-label={tCommon(($) => $.loading)}
            className="flex h-20 items-center justify-center"
          >
            <span
              aria-hidden
              className="i-ri-loader-2-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
            />
          </div>
        )}
        {!isLoading && versionsError && versions.length === 0 && (
          <p role="alert" className="px-2 py-6 text-center system-xs-regular text-text-tertiary">
            {tCommon(($) => $.error)}
          </p>
        )}
        {!isLoading && !versionsError && versions.length === 0 && (
          <p className="px-2 py-6 text-center system-xs-regular text-text-tertiary">
            {t(($) => $['studio.accessPoint.noPublishedTitle'])}
          </p>
        )}
        {isFetchingNextPage && versions.length > 0 && (
          <div
            role="status"
            aria-label={tCommon(($) => $.loading)}
            className="flex h-8 items-center justify-center"
          >
            <span
              aria-hidden
              className="i-ri-loader-2-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
            />
          </div>
        )}
        <div ref={sentinelRef} aria-hidden className="h-px" />
      </div>
    </div>
  )
}

function PublisherDeploymentConfiguration({
  appId,
  currentVersionId,
  disabled,
  environmentId,
  environmentName,
  version,
  onBack,
  onCancel,
  onDeploy,
}: {
  appId?: string
  currentVersionId?: string
  disabled: boolean
  environmentId: string
  environmentName: string
  version: DeploymentVersion
  onBack: () => void
  onCancel: () => void
  onDeploy: (operationId: string) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const request = {
    currentVersionId,
    environment: environmentName,
    environmentId,
    kind: 'deploy' as const,
  }
  const queryState = useDeploymentConfigurationQueries({
    appId,
    environmentId,
    workflowId: version.id,
  })
  const [configurationValues, setConfigurationValues] = useDeploymentConfigurationValues()
  const deploymentInput = queryState.deploymentOptions
    ? workflowDeploymentInput(queryState.deploymentOptions, configurationValues)
    : undefined
  const deployMutation = useDeployWorkflow({
    appId,
    environmentId,
    invalidateAppEnvironmentsOnSuccess: false,
    onSuccess: (response) => onDeploy(response.operation.id),
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
            environment_id: environmentId,
            workflow_id: version.id,
          },
        })
      }}
    >
      <header className="shrink-0 px-3 pt-3.5 pb-1">
        <PublisherBackButton onClick={onBack} />
        <h2 className="mt-0.5 px-1 system-xl-semibold text-text-primary">
          {t(($) => $['studio.deployConfiguration'])}
        </h2>
        <p className="mt-0.5 px-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.deployConfigurationDescription'])}
        </p>
      </header>

      <DeploymentConfigurationContent
        key={version.id}
        compact
        deploymentError={deployMutation.error}
        onValuesChange={setConfigurationValues}
        queryState={queryState}
        request={request}
        values={configurationValues}
        version={version}
      />

      <footer className="flex shrink-0 justify-end gap-2 px-4 pt-2 pb-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
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

function PublisherEnvironmentFlowContent({
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
  const [view, setView] = useState<PublisherEnvironmentView>('publisher')
  const [selectedVersion, setSelectedVersion] = useState<DeploymentVersion>()
  const deploymentPolling = useAtomValue(publisherEnvironmentDeploymentPollingAtom)
  const startDeploymentPolling = useSetAtom(startPublisherEnvironmentDeploymentPollingAtom)
  const currentVersionId = deployment?.deployment?.current_version?.id
  const deploymentActionsDisabled =
    deploymentPolling?.environmentId === environmentId ||
    isEnvironmentDeploymentInProgress(deployment)

  function openVersionSelection() {
    if (deploymentActionsDisabled) return
    setView('versions')
  }

  function openConfiguration(version: DeploymentVersion) {
    if (deploymentActionsDisabled) return
    setSelectedVersion(version)
    setView('configuration')
  }

  if (isDeploymentLoading || isDeploymentError) {
    return (
      <div aria-busy={isDeploymentLoading} className="flex min-h-40 flex-col gap-3 p-4">
        {environmentTabs}
        <div
          role={isDeploymentError ? 'alert' : 'status'}
          className="flex flex-1 items-center justify-center gap-2 system-sm-regular text-text-tertiary"
        >
          {isDeploymentLoading ? (
            <>
              <span aria-hidden className="i-ri-loader-2-line size-4 animate-spin" />
              {t(($) => $.loading, { ns: 'common' })}
            </>
          ) : (
            t(($) => $['common.loadFailed'], { ns: 'deployments' })
          )}
        </div>
      </div>
    )
  }

  if (view === 'configuration' && selectedVersion) {
    return (
      <PublisherDeploymentConfiguration
        appId={appId}
        currentVersionId={currentVersionId}
        disabled={deploymentActionsDisabled}
        environmentId={environmentId}
        environmentName={environmentName}
        version={selectedVersion}
        onBack={openVersionSelection}
        onCancel={() => setView('publisher')}
        onDeploy={(operationId) => {
          startDeploymentPolling({ environmentId, operationId })
          setView('publisher')
        }}
      />
    )
  }

  if (view !== 'publisher') {
    return (
      <PublisherVersionSelection
        currentVersionId={currentVersionId}
        disabled={deploymentActionsDisabled}
        environmentName={environmentName}
        onBack={() => setView('publisher')}
        onSelect={openConfiguration}
      />
    )
  }

  return (
    <div>
      <PublisherEnvironmentSummarySection
        deployment={deployment}
        deploymentActionsDisabled={deploymentActionsDisabled}
        environmentTabs={environmentTabs}
        isEnvironmentInUse={isEnvironmentInUse}
        latestVersion={latestVersion}
        onDeployLatest={() => {
          if (latestVersion) openConfiguration(latestVersion)
        }}
        onDeployOtherVersion={openVersionSelection}
        onGoToPublish={onGoToPublish}
        onShowAllVersions={openVersionSelection}
      />
      <PublisherEnvironmentActionsSection
        appId={appId}
        deployment={deployment}
        environmentId={environmentId}
      />
    </div>
  )
}

export function PublisherEnvironmentFlow(props: PublisherEnvironmentFlowProps) {
  if (!props.appId) return <PublisherEnvironmentFlowContent {...props} />

  return (
    <AppDeployStateBoundary appId={props.appId}>
      <PublisherEnvironmentFlowContent {...props} />
    </AppDeployStateBoundary>
  )
}
