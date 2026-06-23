'use client'

import type {
  AccessChannels,
  ApiKey,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Switch, SwitchSkeleton } from '@langgenius/dify-ui/switch'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../../components/empty-state'
import { DeveloperApiDocsDrawer } from './api-docs-drawer'
import { ApiKeyGenerateMenu } from './api-key-generate-menu'
import { ApiKeyList } from './api-key-list'
import { CopyPill } from './common'
import { CreatedApiTokenDialog } from './developer-api-created-token-dialog'
import { DeveloperApiSkeleton } from './developer-api-skeleton'
import { developerApiSettingsQueryAtom } from './state'

type CreatedApiToken = {
  appInstanceId: string
  token: string
}

function useDeveloperApiSettings() {
  const developerApiSettingsQuery = useAtomValue(developerApiSettingsQueryAtom)
  const accessChannels = developerApiSettingsQuery.data?.accessChannels
  const apiEnabled = accessChannels?.developerApiEnabled ?? false
  const environments = developerApiSettingsQuery.data?.environments ?? []
  const apiKeys: ApiKey[] = developerApiSettingsQuery.data?.apiKeys ?? []
  const apiUrl = developerApiSettingsQuery.data?.developerApiUrl.apiUrl

  return {
    apiEnabled,
    accessChannels,
    apiUrl,
    environments,
    apiKeys,
    isLoading: developerApiSettingsQuery.isLoading,
    isError: developerApiSettingsQuery.isError,
  }
}

function DeveloperApiSwitch({ appInstanceId, checked, accessChannels, disabled }: {
  appInstanceId: string
  checked: boolean
  accessChannels?: AccessChannels
  disabled?: boolean
}) {
  const { t } = useTranslation('deployments')
  const toggleDeveloperAPI = useMutation(consoleQuery.enterprise.accessService.updateAccessChannels.mutationOptions())

  return (
    <Switch
      aria-label={t('access.api.developerTitle')}
      checked={checked}
      disabled={disabled}
      loading={toggleDeveloperAPI.isPending}
      onCheckedChange={(enabled) => {
        toggleDeveloperAPI.mutate({
          params: { appInstanceId },
          body: {
            appInstanceId,
            webAppEnabled: accessChannels?.webAppEnabled ?? false,
            developerApiEnabled: enabled,
          },
        })
      }}
    />
  )
}

export function DeveloperApiHeaderSwitch({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const {
    apiEnabled,
    accessChannels,
    isLoading,
    isError,
  } = useDeveloperApiSettings()

  if (isLoading)
    return <SwitchSkeleton />

  return (
    <div className="flex items-center gap-2">
      <span className="system-xs-medium text-text-tertiary">
        {apiEnabled ? t('overview.enabled') : t('overview.disabled')}
      </span>
      <DeveloperApiSwitch
        appInstanceId={appInstanceId}
        checked={apiEnabled}
        accessChannels={accessChannels}
        disabled={isError}
      />
    </div>
  )
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

function DeveloperApiEndpoint({ appInstanceId, apiUrl }: {
  appInstanceId: string
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
        appInstanceId={appInstanceId}
        apiBaseUrl={apiUrl}
        onOpenChange={setApiDocsOpen}
      />
    </div>
  )
}

export function DeveloperApiSection({
  appInstanceId,
}: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const [createdApiToken, setCreatedApiToken] = useState<CreatedApiToken>()
  const {
    apiEnabled,
    apiUrl,
    apiKeys,
    environments,
    isLoading,
    isError,
  } = useDeveloperApiSettings()
  const visibleCreatedApiToken = createdApiToken?.appInstanceId === appInstanceId
    ? createdApiToken.token
    : undefined
  const hasSelectableEnvironment = environments.some(environment => Boolean(environment.id))

  if (isLoading)
    return <DeveloperApiSkeleton />

  if (isError)
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
          appInstanceId={appInstanceId}
          apiUrl={apiUrl}
        />
      )}
      {hasSelectableEnvironment
        ? (
            <ApiKeyGenerateMenu
              appInstanceId={appInstanceId}
              environments={environments}
              triggerVariant="primary"
              onCreatedToken={token => setCreatedApiToken({ appInstanceId, token })}
            >
              {({ trigger }) => apiKeys.length === 0
                ? (
                    <DeploymentEmptyState
                      variant="section"
                      icon="i-ri-key-2-line"
                      title={t('access.api.noKeysTitle')}
                      description={t('access.api.noKeys')}
                      action={trigger}
                    />
                  )
                : (
                    <ApiKeyListSection
                      apiKeys={apiKeys}
                      environments={environments}
                      action={trigger}
                    />
                  )}
            </ApiKeyGenerateMenu>
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
      {visibleCreatedApiToken && (
        <CreatedApiTokenDialog
          token={visibleCreatedApiToken}
          apiUrl={apiUrl}
          onDismiss={() => setCreatedApiToken(undefined)}
        />
      )}
    </div>
  )
}
