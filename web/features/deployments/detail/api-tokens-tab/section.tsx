'use client'

import type {
  ApiKey,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../components/empty-state'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'
import { CopyPill } from '../components/endpoint'
import { ApiKeyList } from './api-key-list'
import { CreateApiKeyButton } from './create-api-key-button'
import { CreateApiKeyDialog } from './create-api-key-dialog'
import { CreatedApiTokenDialog } from './created-token-dialog'
import { DeveloperApiDocsDrawer } from './docs-drawer'
import { DeveloperApiSkeleton } from './skeleton'
import { developerApiSettingsQueryAtom } from './state'

type CreatedApiToken = {
  appInstanceId: string
  token: string
}

function ApiKeyListSection({ apiKeys, environments, action }: {
  apiKeys: ApiKey[]
  environments: Environment[]
  action?: ReactNode
}) {
  const { t } = useTranslation('deployments')
  const hasAction = Boolean(action)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="system-xs-semibold-uppercase text-text-tertiary">
          {t('access.api.keyList')}
        </div>
        {hasAction && (
          <div className="w-full shrink-0 sm:w-auto [&_button]:w-full sm:[&_button]:w-auto">
            {action}
          </div>
        )}
      </div>
      <ApiKeyList
        apiKeys={apiKeys}
        environments={environments}
      />
    </div>
  )
}

function DeveloperApiEndpoint({ apiUrl }: {
  apiUrl: string
}) {
  const { t } = useTranslation('deployments')
  const [apiDocsOpen, setApiDocsOpen] = useState(false)

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <CopyPill
        label={t('access.api.endpoint')}
        value={apiUrl}
        className="min-w-0 flex-1"
      />
      <Button
        variant="secondary"
        className="shrink-0 gap-1.5"
        onClick={() => setApiDocsOpen(true)}
      >
        <span className="i-ri-file-list-3-line size-3.5" />
        {t('access.api.docs')}
      </Button>
      <DeveloperApiDocsDrawer
        open={apiDocsOpen}
        apiBaseUrl={apiUrl}
        onOpenChange={setApiDocsOpen}
      />
    </div>
  )
}

export function ApiTokensSection() {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const [createdApiToken, setCreatedApiToken] = useState<CreatedApiToken>()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDialogSessionKey, setCreateDialogSessionKey] = useState(0)
  const developerApiSettingsQuery = useAtomValue(developerApiSettingsQueryAtom)
  const accessChannels = developerApiSettingsQuery.data?.accessChannels
  const apiEnabled = accessChannels?.developerApiEnabled ?? false
  const apiUrl = developerApiSettingsQuery.data?.developerApiUrl.apiUrl
  const apiKeys: ApiKey[] = developerApiSettingsQuery.data?.apiKeys ?? []
  const environments = developerApiSettingsQuery.data?.environments ?? []
  const selectableEnvironments = environments.flatMap((environment) => {
    if (!environment.id)
      return []

    return [environment]
  })
  const visibleCreatedApiToken = createdApiToken && createdApiToken.appInstanceId === appInstanceId
    ? createdApiToken.token
    : undefined
  const hasSelectableEnvironment = selectableEnvironments.length > 0

  function handleOpenCreateDialog() {
    if (!hasSelectableEnvironment)
      return

    setCreateDialogSessionKey(sessionKey => sessionKey + 1)
    setCreateDialogOpen(true)
  }

  if (developerApiSettingsQuery.isLoading)
    return <DeveloperApiSkeleton />

  if (developerApiSettingsQuery.isError || !appInstanceId)
    return <DeploymentStateMessage variant="section">{t('common.loadFailed')}</DeploymentStateMessage>

  if (!apiEnabled) {
    return (
      <DeploymentEmptyState
        variant="section"
        icon="i-ri-toggle-line"
        title={t('access.api.disabled')}
        description={t('access.api.disabledHint')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {apiUrl && (
        <DeveloperApiEndpoint
          apiUrl={apiUrl}
        />
      )}
      {hasSelectableEnvironment
        ? apiKeys.length === 0
          ? (
              <DeploymentEmptyState
                variant="section"
                icon="i-ri-key-2-line"
                title={t('access.api.noKeysTitle')}
                description={t('access.api.noKeys')}
                action={(
                  <CreateApiKeyButton
                    triggerVariant="primary"
                    onClick={handleOpenCreateDialog}
                  />
                )}
              />
            )
          : (
              <ApiKeyListSection
                apiKeys={apiKeys}
                environments={environments}
                action={(
                  <CreateApiKeyButton
                    triggerVariant="primary"
                    onClick={handleOpenCreateDialog}
                  />
                )}
              />
            )
        : apiKeys.length === 0
          ? (
              <DeploymentEmptyState
                variant="section"
                icon="i-ri-rocket-line"
                title={t('access.api.emptyTitle')}
                description={t('access.api.empty')}
              />
            )
          : (
              <ApiKeyListSection
                apiKeys={apiKeys}
                environments={environments}
              />
            )}
      <CreateApiKeyDialog
        appInstanceId={appInstanceId}
        environments={selectableEnvironments}
        open={createDialogOpen}
        sessionKey={createDialogSessionKey}
        onCreatedToken={token => setCreatedApiToken({ appInstanceId, token })}
        onOpenChange={setCreateDialogOpen}
      />
      <CreatedApiTokenDialog
        token={visibleCreatedApiToken}
        apiUrl={apiUrl}
        onDismiss={() => setCreatedApiToken(undefined)}
      />
    </div>
  )
}
