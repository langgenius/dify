'use client'

import type {
  ApiKey,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Switch, SwitchSkeleton } from '@langgenius/dify-ui/switch'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { atom, useAtom, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { SectionState } from '../../common'
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

function deploymentEnvironment(row: { environment?: Environment }): Environment | undefined {
  return row.environment?.id ? row.environment : undefined
}

function useDeveloperApiStatus(appInstanceId: string) {
  const accessChannelsQuery = useQuery(consoleQuery.enterprise.accessService.getAccessChannels.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const apiEnabled = accessChannelsQuery.data?.accessChannels?.developerApiEnabled ?? false

  return {
    apiEnabled,
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
  const apiKeysLoading = apiKeyQueries.some(query => query.isLoading)
  const apiKeysError = apiKeyQueries.some(query => query.isError)

  return {
    apiEnabled,
    environments,
    apiKeys,
    isLoading: accessChannelsLoading || environmentDeploymentsQuery.isLoading || (apiEnabled && apiKeysLoading),
    isError: accessChannelsError || environmentDeploymentsQuery.isError || (apiEnabled && apiKeysError),
  }
}

function DeveloperApiSwitch({ appInstanceId, checked, disabled }: {
  appInstanceId: string
  checked: boolean
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
          body: { appInstanceId, developerApiEnabled: enabled },
        })
      }}
    />
  )
}

export function DeveloperApiHeaderSwitch({ appInstanceId }: {
  appInstanceId: string
}) {
  const {
    apiEnabled,
    isLoading,
    isError,
  } = useDeveloperApiStatus(appInstanceId)

  if (isLoading)
    return <SwitchSkeleton />

  return (
    <DeveloperApiSwitch
      appInstanceId={appInstanceId}
      checked={apiEnabled}
      disabled={isError}
    />
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

  return (
    <ApiKeyGenerateMenu
      appInstanceId={appInstanceId}
      environments={environments}
      apiKeys={apiKeys}
      onCreatedToken={token => setCreatedApiToken({ appInstanceId, token })}
    />
  )
}

function CreatedApiTokenDialog({ token, onDismiss }: {
  token: string
  onDismiss: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <Dialog open={Boolean(token)} onOpenChange={open => !open && onDismiss()}>
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
      <ApiKeyTableSkeleton />
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

export function DeveloperApiSection({
  appInstanceId,
}: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const [createdApiToken, setCreatedApiToken] = useAtom(createdApiTokenAtom)
  const {
    apiEnabled,
    apiKeys,
    environments,
    isLoading,
    isError,
  } = useDeveloperApiResources(appInstanceId)
  const apiUrl = environments.find(environment => environment.runtimeEndpoint)?.runtimeEndpoint
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
                        <SectionState>
                          {environments.length === 0
                            ? t('access.api.empty')
                            : t('access.api.noKeys')}
                        </SectionState>
                      )
                    : (
                        <ApiKeyList
                          apiKeys={apiKeys}
                          environments={environments}
                        />
                      )}
                  {visibleCreatedApiToken && (
                    <CreatedApiTokenDialog
                      token={visibleCreatedApiToken}
                      onDismiss={() => setCreatedApiToken(undefined)}
                    />
                  )}
                </div>
              )
            : (
                <div className="system-xs-regular text-text-tertiary">
                  {t('access.api.disabled')}
                </div>
              )}
    </>
  )
}
