'use client'

import type { ReactNode } from 'react'
import type { MockEnvironmentDeployment, MockVersion } from '@/app/components/app/deploy/mock-data'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeploymentConfigurationContent } from '@/app/components/app/deploy/deployment-dialog/deployment-configuration'
import { VersionChoice } from '@/app/components/app/deploy/deployment-dialog/version-selection'
import { MOCK_PUBLISHED_VERSIONS } from '@/app/components/app/deploy/mock-data'
import {
  PublisherEnvironmentActionsSection,
  PublisherEnvironmentSummarySection,
} from './environment-sections'

type PublisherEnvironmentView = 'configuration' | 'publisher' | 'versions'

type PublisherEnvironmentFlowProps = {
  appId?: string
  deployment?: MockEnvironmentDeployment
  environmentId: string
  environmentTabs: ReactNode
  latestVersion?: MockVersion
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
  currentVersion,
  environmentName,
  onBack,
  onSelect,
}: {
  currentVersion?: string
  environmentName: string
  onBack: () => void
  onSelect: (version: MockVersion) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-3 pt-3.5 pb-1">
        <PublisherBackButton onClick={onBack} />
        <h2 className="mt-0.5 px-1 system-xl-semibold text-text-primary">
          {t(($) => $['versions.deployTo'], { name: environmentName })}
        </h2>
        <p className="mt-0.5 px-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.chooseVersionToDeploy'])}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-px">
          {MOCK_PUBLISHED_VERSIONS.map((version) => (
            <VersionChoice
              key={version.name}
              version={version}
              current={version.name === currentVersion}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PublisherDeploymentConfiguration({
  currentVersion,
  environmentName,
  version,
  onBack,
  onCancel,
  onDeploy,
}: {
  currentVersion?: string
  environmentName: string
  version: MockVersion
  onBack: () => void
  onCancel: () => void
  onDeploy: () => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const request = {
    currentVersion,
    environment: environmentName,
    kind: 'deploy' as const,
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        onDeploy()
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
        key={version.name}
        compact
        request={request}
        version={version}
      />

      <footer className="flex shrink-0 justify-end gap-2 px-4 pt-2 pb-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button type="submit" variant="primary">
          {tCommon(($) => $['appMenus.deploy'])}
        </Button>
      </footer>
    </form>
  )
}

export function PublisherEnvironmentFlow({
  appId,
  deployment,
  environmentId,
  environmentTabs,
  latestVersion,
  onGoToPublish,
}: PublisherEnvironmentFlowProps) {
  const [view, setView] = useState<PublisherEnvironmentView>('publisher')
  const [selectedVersion, setSelectedVersion] = useState<MockVersion>()
  const environmentName = deployment?.name ?? environmentId
  const currentVersion = deployment?.version?.name

  function openVersionSelection() {
    setView('versions')
  }

  function openConfiguration(version: MockVersion) {
    setSelectedVersion(version)
    setView('configuration')
  }

  if (view === 'configuration' && selectedVersion) {
    return (
      <PublisherDeploymentConfiguration
        currentVersion={currentVersion}
        environmentName={environmentName}
        version={selectedVersion}
        onBack={openVersionSelection}
        onCancel={() => setView('publisher')}
        onDeploy={() => setView('publisher')}
      />
    )
  }

  if (view !== 'publisher') {
    return (
      <PublisherVersionSelection
        currentVersion={currentVersion}
        environmentName={environmentName}
        onBack={() => setView('publisher')}
        onSelect={openConfiguration}
      />
    )
  }

  return (
    <>
      <PublisherEnvironmentSummarySection
        deployment={deployment}
        environmentTabs={environmentTabs}
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
    </>
  )
}
