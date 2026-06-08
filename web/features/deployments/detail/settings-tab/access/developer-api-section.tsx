'use client'

import type {
  AccessChannels,
  ApiKey,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Switch, SwitchSkeleton } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery } from '@tanstack/react-query'
import { atom, useAtom, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { DetailEmptyState, SectionState } from '../../common'
import { DeveloperApiDocsDrawer } from './api-docs-drawer'
import { ApiKeyGenerateMenu } from './api-key-generate-menu'
import { ApiKeyList } from './api-key-list'
import { CopyPill } from './common'
import { CreatedApiTokenDialog } from './developer-api-created-token-dialog'
import { DeveloperApiSkeleton } from './developer-api-skeleton'

type CreatedApiToken = {
  appInstanceId: string
  token: string
}

const createdApiTokenAtom = atom<CreatedApiToken | undefined>(undefined)

function useDeveloperApiStatus(appInstanceId: string) {
  const developerApiSettingsQuery = useQuery(consoleQuery.enterprise.accessService.getDeveloperApiSettings.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessChannels = developerApiSettingsQuery.data?.accessChannels
  const apiEnabled = accessChannels?.developerApiEnabled ?? false

  return {
    apiEnabled,
    accessChannels,
    isLoading: developerApiSettingsQuery.isLoading,
    isError: developerApiSettingsQuery.isError,
  }
}

function useDeveloperApiResources(appInstanceId: string) {
  const developerApiSettingsQuery = useQuery(consoleQuery.enterprise.accessService.getDeveloperApiSettings.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessChannels = developerApiSettingsQuery.data?.accessChannels
  const apiEnabled = accessChannels?.developerApiEnabled ?? false
  const environments = developerApiSettingsQuery.data?.environments?.filter((environment): environment is Environment & { id: string } => Boolean(environment.id)) ?? []
  const apiKeys: ApiKey[] = developerApiSettingsQuery.data?.apiKeys ?? []
  const apiUrl = developerApiSettingsQuery.data?.developerApiUrl?.apiUrl

  return {
    apiEnabled,
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
  const toggleDeveloperAPI = useMutation(consoleQuery.enterprise.accessService.updateAccessChannels.mutationOptions())

  return (
    <Switch
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
  } = useDeveloperApiStatus(appInstanceId)

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

export function DeveloperApiHeaderActions({ appInstanceId }: {
  appInstanceId: string
}) {
  const setCreatedApiToken = useSetAtom(createdApiTokenAtom)
  const {
    apiEnabled,
    apiKeys,
    environments,
    isLoading,
  } = useDeveloperApiResources(appInstanceId)

  if (isLoading) {
    return <SkeletonRectangle className="my-0 h-8 w-32 animate-pulse rounded-lg" />
  }

  if (!apiEnabled)
    return null

  if (apiKeys.length === 0)
    return null

  return (
    <ApiKeyGenerateMenu
      appInstanceId={appInstanceId}
      environments={environments}
      onCreatedToken={token => setCreatedApiToken({ appInstanceId, token })}
    />
  )
}

function ApiKeyListSection({ apiKeys, environments }: {
  apiKeys: ApiKey[]
  environments: Environment[]
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex flex-col gap-2">
      <div className="system-xs-semibold-uppercase text-text-tertiary">
        {t('access.api.keyList')}
      </div>
      <ApiKeyList
        apiKeys={apiKeys}
        environments={environments}
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
  const [createdApiToken, setCreatedApiToken] = useAtom(createdApiTokenAtom)
  const [apiDocsOpen, setApiDocsOpen] = useState(false)
  const {
    apiEnabled,
    apiUrl,
    apiKeys,
    environments,
    isLoading,
    isError,
  } = useDeveloperApiResources(appInstanceId)
  const visibleCreatedApiToken = createdApiToken?.appInstanceId === appInstanceId
    ? createdApiToken.token
    : undefined

  return (
    <>
      {isLoading
        ? <DeveloperApiSkeleton />
        : isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : apiEnabled
            ? (
                <div className="flex flex-col gap-4">
                  {apiUrl && (
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
                  )}
                  {environments.length > 0
                    ? (
                        <ApiKeyGenerateMenu
                          appInstanceId={appInstanceId}
                          environments={environments}
                          triggerVariant="primary"
                          onCreatedToken={token => setCreatedApiToken({ appInstanceId, token })}
                        >
                          {({ trigger }) => apiKeys.length === 0
                            ? (
                                <DetailEmptyState
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
                                />
                              )}
                        </ApiKeyGenerateMenu>
                      )
                    : apiKeys.length === 0
                      ? (
                          <DetailEmptyState
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
            : (
                <DetailEmptyState
                  variant="section"
                  icon="i-ri-toggle-line"
                  title={t('access.api.disabled')}
                  description={t('access.api.disabledHint')}
                />
              )}
    </>
  )
}
