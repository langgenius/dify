'use client'

import type {
  AppDeployEnvironment,
  EnvironmentAccessRow,
} from '@dify/contracts/enterprise/types.gen'
import { Switch, SwitchSkeleton } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery } from '@tanstack/react-query'
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

function permissionEnvironment(row: EnvironmentAccessRow): AppDeployEnvironment | undefined {
  return row.environment?.id ? row.environment : undefined
}

function DeveloperApiSwitch({ appInstanceId, checked, disabled }: {
  appInstanceId: string
  checked: boolean
  disabled?: boolean
}) {
  const toggleDeveloperAPI = useMutation(consoleQuery.enterprise.appDeployAccessService.updateDeveloperApi.mutationOptions())

  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={(enabled) => {
        toggleDeveloperAPI.mutate({
          params: { appInstanceId },
          body: { appInstanceId, enabled },
        })
      }}
    />
  )
}

export function DeveloperApiHeaderActions({ appInstanceId }: {
  appInstanceId: string
}) {
  const setCreatedApiToken = useSetAtom(createdApiTokenAtom)
  const accessConfigQuery = useQuery(consoleQuery.enterprise.appDeployAccessService.getAppInstanceAccess.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessConfig = accessConfigQuery.data
  const apiEnabled = accessConfig?.developerApi?.enabled ?? false
  const apiKeys = accessConfig?.developerApi?.apiKeys ?? []
  const environments = accessConfig?.permissions
    ?.map(permissionEnvironment)
    .filter((environment): environment is AppDeployEnvironment => Boolean(environment)) ?? []

  if (accessConfigQuery.isLoading) {
    return (
      <div className="flex items-center gap-2">
        <SkeletonRectangle className="my-0 h-8 w-32 animate-pulse rounded-lg" />
        <SwitchSkeleton />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {apiEnabled && (
        <ApiKeyGenerateMenu
          appInstanceId={appInstanceId}
          environments={environments}
          apiKeys={apiKeys}
          onCreatedToken={token => setCreatedApiToken({ appInstanceId, token })}
        />
      )}
      <DeveloperApiSwitch
        appInstanceId={appInstanceId}
        checked={apiEnabled}
        disabled={accessConfigQuery.isError}
      />
    </div>
  )
}

function CreatedApiTokenCard({ token, onDismiss }: {
  token: string
  onDismiss: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex flex-col gap-2 border-y border-divider-subtle bg-background-default-subtle px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="system-sm-medium text-text-primary">
            {t('access.api.newTokenTitle')}
          </span>
          <span className="system-xs-regular text-text-tertiary">
            {t('access.api.newTokenDescription')}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('access.api.dismissToken')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <span className="i-ri-close-line size-3.5" />
        </button>
      </div>
      <CopyPill
        label={t('access.api.newTokenLabel')}
        value={token}
      />
    </div>
  )
}

function DeveloperApiSkeleton() {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex flex-col gap-4" data-slot="deployment-developer-api-skeleton">
      <div className="flex h-8 items-center gap-1 rounded-lg border border-components-input-border-active bg-components-input-bg-normal pr-1 pl-1.5">
        <div className="flex h-5 shrink-0 items-center rounded-md border border-divider-subtle px-1.5 system-2xs-medium text-text-tertiary">
          {t('access.api.endpoint')}
        </div>
        <SkeletonRectangle className="my-0 h-3 min-w-0 flex-1 animate-pulse" />
        <div className="h-3.5 w-px shrink-0 bg-divider-regular" />
        <SkeletonRectangle className="my-0 size-6 shrink-0 animate-pulse rounded-md" />
      </div>
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
  const accessConfigQuery = useQuery(consoleQuery.enterprise.appDeployAccessService.getAppInstanceAccess.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessConfig = accessConfigQuery.data
  const apiEnabled = accessConfig?.developerApi?.enabled ?? false
  const apiUrl = accessConfig?.developerApi?.apiUrl
  const apiKeys = accessConfig?.developerApi?.apiKeys ?? []
  const environments = accessConfig?.permissions
    ?.map(permissionEnvironment)
    .filter((environment): environment is AppDeployEnvironment => Boolean(environment)) ?? []
  const visibleCreatedApiToken = createdApiToken?.appInstanceId === appInstanceId
    ? createdApiToken.token
    : undefined

  return (
    <>
      {accessConfigQuery.isLoading
        ? <DeveloperApiSkeleton />
        : accessConfigQuery.isError
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
                  {visibleCreatedApiToken && (
                    <CreatedApiTokenCard
                      token={visibleCreatedApiToken}
                      onDismiss={() => setCreatedApiToken(undefined)}
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
                          appInstanceId={appInstanceId}
                          apiKeys={apiKeys}
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
