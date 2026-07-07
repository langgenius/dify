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
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../../shared/components/empty-state'
import { CopyPill } from '../../../shared/components/endpoint'
import { ApiKeyGenerateMenu } from '../api-keys/api-key-generate-menu'
import { ApiKeyList } from '../api-keys/api-key-list'
import { CreatedApiTokenDialog } from '../api-keys/created-token-dialog'
import { DeveloperApiDocsDrawer } from '../docs/docs-drawer'
import {
  developerApiSettingsAtom,
  developerApiSettingsIsErrorAtom,
  developerApiSettingsIsLoadingAtom,
} from '../state'
import { DeveloperApiSkeleton } from './skeleton'

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

export function DeveloperApiSection() {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const [createdApiToken, setCreatedApiToken] = useState<CreatedApiToken>()
  const developerApiSettings = useAtomValue(developerApiSettingsAtom)
  const isLoading = useAtomValue(developerApiSettingsIsLoadingAtom)
  const isError = useAtomValue(developerApiSettingsIsErrorAtom)
  const accessChannels = developerApiSettings?.accessChannels
  const apiEnabled = accessChannels?.developerApiEnabled ?? false
  const apiUrl = developerApiSettings?.developerApiUrl.apiUrl
  const apiKeys: ApiKey[] = developerApiSettings?.apiKeys ?? []
  const environments = developerApiSettings?.environments ?? []
  const visibleCreatedApiToken = createdApiToken && createdApiToken.appInstanceId === appInstanceId
    ? createdApiToken.token
    : undefined
  const hasSelectableEnvironment = environments.some(environment => Boolean(environment.id))

  if (isLoading)
    return <DeveloperApiSkeleton />

  if (isError || !appInstanceId)
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
        ? (
            <ApiKeyGenerateMenu
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
