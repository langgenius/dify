'use client'

import type {
  AccessChannels,
  ApiKey,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Switch, SwitchSkeleton } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { atom, useAtom, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useClipboard } from '@/hooks/use-clipboard'
import { consoleQuery } from '@/service/client'
import { DetailEmptyState, SectionState } from '../../common'
import {
  DetailTable,
  DetailTableBody,
  DetailTableCard,
  DetailTableCardList,
  DetailTableCell,
  DetailTableHead,
  DetailTableHeader,
  DetailTableRow,
} from '../../table'
import { API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES } from '../../table-styles'
import { ApiKeyGenerateMenu, ApiKeyList } from './api-keys'
import { CopyPill } from './common'

type CreatedApiToken = {
  appInstanceId: string
  token: string
}

const createdApiTokenAtom = atom<CreatedApiToken | undefined>(undefined)

const DEVELOPER_API_KEY_SKELETON_KEYS = ['primary-key', 'secondary-key']

function buildCurlExample(apiUrl: string, token: string) {
  return `curl -X POST '${apiUrl}' \\
--header 'Authorization: Bearer ${token}' \\
--header 'Content-Type: application/json' \\
--data-raw '{
  "inputs": {},
  "response_mode": "streaming",
  "user": "abc-123"
}'`
}

function deploymentEnvironment(row: { environment?: Environment }): Environment | undefined {
  return row.environment?.id ? row.environment : undefined
}

function useDeveloperApiStatus(appInstanceId: string) {
  const accessChannelsQuery = useQuery(consoleQuery.enterprise.accessService.getAccessChannels.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessChannels = accessChannelsQuery.data?.accessChannels
  const apiEnabled = accessChannels?.developerApiEnabled ?? false

  return {
    apiEnabled,
    accessChannels,
    isLoading: accessChannelsQuery.isLoading,
    isError: accessChannelsQuery.isError,
  }
}

function useDeveloperApiResources(appInstanceId: string) {
  const {
    apiEnabled,
    isLoading: accessChannelsLoading,
    isError: accessChannelsError,
  } = useDeveloperApiStatus(appInstanceId)
  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const environments = environmentDeploymentsQuery.data?.data
    ?.map(deploymentEnvironment)
    .filter((environment): environment is Environment & { id: string } => Boolean(environment)) ?? []
  const apiKeyQueries = useQueries({
    queries: environments.map(environment => consoleQuery.enterprise.accessService.listApiKeys.queryOptions({
      input: {
        params: {
          appInstanceId,
          environmentId: environment.id,
        },
      },
      enabled: Boolean(apiEnabled),
    })),
  })
  const apiKeys: ApiKey[] = apiKeyQueries.flatMap(query => query.data?.data ?? [])
  const apiUrl = apiKeyQueries.find(query => query.data?.apiUrl)?.data?.apiUrl
  const apiKeysLoading = apiKeyQueries.some(query => query.isLoading)
  const apiKeysError = apiKeyQueries.some(query => query.isError)

  return {
    apiEnabled,
    apiUrl,
    environments,
    apiKeys,
    isLoading: accessChannelsLoading || environmentDeploymentsQuery.isLoading || (apiEnabled && apiKeysLoading),
    isError: accessChannelsError || environmentDeploymentsQuery.isError || (apiEnabled && apiKeysError),
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

function CurlExample({ apiUrl, token }: {
  apiUrl: string
  token: string
}) {
  const { t } = useTranslation('deployments')
  const curlExample = buildCurlExample(apiUrl, token)
  const { copied, copy } = useClipboard({
    onCopyError: () => {
      toast.error(t('access.copyFailed'))
    },
  })

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-components-input-border-active bg-components-input-bg-normal">
      <div className="flex h-8 items-center justify-between gap-2 border-b border-divider-subtle pr-1.5 pl-3">
        <div className="min-w-0 truncate system-xs-semibold-uppercase text-text-secondary">
          {t('access.api.curlExampleTitle')}
        </div>
        <button
          type="button"
          onClick={() => copy(curlExample)}
          aria-label={t('access.api.copyCurlExample')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <span className={cn(copied ? 'i-ri-check-line' : 'i-ri-file-copy-line', 'size-3.5')} />
        </button>
      </div>
      <pre className="max-h-40 overflow-auto px-3 py-3 font-mono system-xs-regular whitespace-pre text-text-secondary">
        <code>{curlExample}</code>
      </pre>
    </div>
  )
}

function CreatedApiTokenDialog({ token, apiUrl, onDismiss }: {
  token: string
  apiUrl?: string
  onDismiss: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <Dialog open={Boolean(token)} onOpenChange={open => !open && onDismiss()} disablePointerDismissal>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] overflow-hidden p-0">
        <DialogCloseButton />
        <div className="border-b border-divider-subtle px-6 py-5 pr-14">
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {t('access.api.newTokenTitle')}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t('access.api.newTokenDescription')}
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          <CopyPill
            label={t('access.api.newTokenLabel')}
            value={token}
          />
          {apiUrl && (
            <CurlExample
              apiUrl={apiUrl}
              token={token}
            />
          )}
        </div>

        <div className="flex justify-end border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
          <Button variant="primary" onClick={onDismiss}>
            {t('operation.confirm', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeveloperApiSkeleton() {
  return (
    <div className="flex flex-col gap-4" data-slot="deployment-developer-api-skeleton">
      <ApiUrlSkeleton />
      <ApiKeyTableSkeleton />
    </div>
  )
}

function ApiUrlSkeleton() {
  return (
    <div
      className="flex h-8 items-center gap-1 rounded-lg border border-components-input-border-active bg-components-input-bg-normal pr-1 pl-1.5"
      data-slot="deployment-developer-api-url-skeleton"
    >
      <SkeletonRectangle className="my-0 h-5 w-16 shrink-0 animate-pulse rounded-md" />
      <SkeletonRectangle className="my-0 h-4 min-w-0 flex-1 animate-pulse" />
      <div className="h-3.5 w-px shrink-0 bg-divider-regular" />
      <SkeletonRectangle className="my-0 size-6 shrink-0 animate-pulse rounded-md" />
    </div>
  )
}

function ApiKeyTableSkeleton() {
  return (
    <>
      <DetailTableCardList className="pc:hidden">
        {DEVELOPER_API_KEY_SKELETON_KEYS.map(key => (
          <DetailTableCard key={key} data-slot="deployment-developer-api-mobile-row-skeleton">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SkeletonRectangle className="my-0 h-3.5 w-32 animate-pulse" />
                  <SkeletonRectangle className="mt-2 h-5 w-20 animate-pulse rounded-md" />
                </div>
                <SkeletonRectangle className="my-0 size-8 shrink-0 animate-pulse rounded-md" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <SkeletonRectangle className="my-0 h-2.5 w-14 animate-pulse" />
                <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
              </div>
            </div>
          </DetailTableCard>
        ))}
      </DetailTableCardList>
      <div className="hidden pc:block">
        <DetailTable>
          <ApiKeyTableHeaderSkeleton />
          <DetailTableBody>
            {DEVELOPER_API_KEY_SKELETON_KEYS.map(key => (
              <ApiKeyDesktopRowSkeleton key={key} />
            ))}
          </DetailTableBody>
        </DetailTable>
      </div>
    </>
  )
}

function ApiKeyTableHeaderSkeleton() {
  const { t } = useTranslation('deployments')

  return (
    <DetailTableHeader>
      <DetailTableRow>
        <DetailTableHead className={API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES.name}>{t('access.api.table.name')}</DetailTableHead>
        <DetailTableHead className={API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>{t('access.api.table.environment')}</DetailTableHead>
        <DetailTableHead className={API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES.key}>{t('access.api.table.key')}</DetailTableHead>
        <DetailTableHead className={`${API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES.action} text-right`}>{t('access.api.table.action')}</DetailTableHead>
      </DetailTableRow>
    </DetailTableHeader>
  )
}

function ApiKeyDesktopRowSkeleton() {
  return (
    <DetailTableRow data-slot="deployment-developer-api-desktop-row-skeleton">
      <DetailTableCell>
        <SkeletonRectangle className="my-0 h-3.5 w-32 animate-pulse" />
      </DetailTableCell>
      <DetailTableCell>
        <SkeletonRectangle className="my-0 h-5 w-20 animate-pulse rounded-md" />
      </DetailTableCell>
      <DetailTableCell>
        <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
      </DetailTableCell>
      <DetailTableCell>
        <div className="flex justify-end">
          <SkeletonRectangle className="my-0 size-8 animate-pulse rounded-md" />
        </div>
      </DetailTableCell>
    </DetailTableRow>
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
                    <CopyPill
                      label={t('access.api.endpoint')}
                      value={apiUrl}
                    />
                  )}
                  {apiKeys.length === 0
                    ? (
                        <DetailEmptyState
                          variant="section"
                          icon={environments.length === 0 ? 'i-ri-rocket-line' : 'i-ri-key-2-line'}
                          title={environments.length === 0
                            ? t('access.api.emptyTitle')
                            : t('access.api.noKeysTitle')}
                          description={environments.length === 0
                            ? t('access.api.empty')
                            : t('access.api.noKeys')}
                          action={(
                            environments.length > 0
                              ? (
                                  <ApiKeyGenerateMenu
                                    appInstanceId={appInstanceId}
                                    environments={environments}
                                    triggerVariant="primary"
                                    onCreatedToken={token => setCreatedApiToken({ appInstanceId, token })}
                                  />
                                )
                              : undefined
                          )}
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
