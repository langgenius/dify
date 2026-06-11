'use client'

import type {
  ApiKey,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
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
import {
  API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES,
} from '../../table-styles'

function ApiKeyName({ apiKey }: {
  apiKey: ApiKey
}) {
  return (
    <span className="block truncate text-text-primary">
      {apiKey.displayName}
    </span>
  )
}

function EnvironmentBadge({ environment }: {
  environment?: Environment
}) {
  return (
    <span className="inline-flex h-5 max-w-36 items-center rounded-md bg-background-section-burn px-1.5 text-xs text-text-tertiary">
      <span className="truncate">{environment?.displayName ?? '—'}</span>
    </span>
  )
}

function ApiKeyValue({ value }: {
  value: string
}) {
  return (
    <div className="flex h-8 min-w-0 items-center rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2">
      <div className="min-w-0 flex-1 truncate font-mono system-sm-medium text-text-secondary">
        {value}
      </div>
    </div>
  )
}

function RevokeApiKeyButton({ apiKey }: {
  apiKey: ApiKey
}) {
  const { t } = useTranslation('deployments')
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false)
  const revokeApiKey = useMutation(consoleQuery.enterprise.accessService.deleteApiKey.mutationOptions())
  const isRevoking = revokeApiKey.isPending
  const apiKeyName = apiKey.displayName

  function handleRevoke() {
    if (isRevoking)
      return

    revokeApiKey.mutate(
      {
        params: {
          appInstanceId: apiKey.appInstanceId,
          environmentId: apiKey.environmentId,
          apiKeyId: apiKey.id,
        },
      },
      {
        onSuccess: () => {
          setShowRevokeConfirm(false)
          toast.success(t('access.api.revokeSuccess'))
        },
        onError: () => {
          toast.error(t('access.api.revokeFailed'))
        },
      },
    )
  }

  function handleRevokeConfirmOpenChange(open: boolean) {
    if (isRevoking)
      return

    setShowRevokeConfirm(open)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowRevokeConfirm(true)}
        aria-label={t('access.revoke')}
        aria-busy={isRevoking}
        disabled={isRevoking}
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          isRevoking
            ? 'cursor-not-allowed opacity-60'
            : 'hover:bg-state-destructive-hover hover:text-text-destructive',
        )}
      >
        <span className={cn(isRevoking ? 'i-ri-loader-2-line animate-spin' : 'i-ri-delete-bin-line', 'size-3.5')} />
      </button>
      <AlertDialog open={showRevokeConfirm} onOpenChange={handleRevokeConfirmOpenChange}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('access.api.revokeConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('access.api.revokeConfirmDescription', { name: apiKeyName })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={isRevoking}>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isRevoking} disabled={isRevoking} onClick={handleRevoke}>
              {t('access.revoke')}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ApiKeyMobileRow({ apiKey, environment }: {
  apiKey: ApiKey
  environment?: Environment
}) {
  const { t } = useTranslation('deployments')
  const displayValue = apiKey.maskedToken

  return (
    <DetailTableCard>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <ApiKeyName apiKey={apiKey} />
            <div className="mt-1">
              <EnvironmentBadge environment={environment} />
            </div>
          </div>
          <RevokeApiKeyButton apiKey={apiKey} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="system-2xs-medium-uppercase text-text-tertiary">
            {t('access.api.table.key')}
          </span>
          <ApiKeyValue value={displayValue} />
        </div>
      </div>
    </DetailTableCard>
  )
}

function ApiKeyDesktopRow({ apiKey, environment }: {
  apiKey: ApiKey
  environment?: Environment
}) {
  const displayValue = apiKey.maskedToken

  return (
    <DetailTableRow>
      <DetailTableCell>
        <ApiKeyName apiKey={apiKey} />
      </DetailTableCell>
      <DetailTableCell>
        <EnvironmentBadge environment={environment} />
      </DetailTableCell>
      <DetailTableCell>
        <ApiKeyValue value={displayValue} />
      </DetailTableCell>
      <DetailTableCell>
        <div className="flex justify-end">
          <RevokeApiKeyButton apiKey={apiKey} />
        </div>
      </DetailTableCell>
    </DetailTableRow>
  )
}

function ApiKeyTableHeader() {
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

export function ApiKeyList({ apiKeys, environments }: {
  apiKeys: ApiKey[]
  environments: Environment[]
}) {
  const environmentById = new Map(environments.map(environment => [environment.id, environment]))

  return (
    <>
      <DetailTableCardList className={cn('pc:hidden')}>
        {apiKeys.map(apiKey => (
          <ApiKeyMobileRow
            key={apiKey.id}
            apiKey={apiKey}
            environment={environmentById.get(apiKey.environmentId)}
          />
        ))}
      </DetailTableCardList>
      <div className="hidden pc:block">
        <DetailTable>
          <ApiKeyTableHeader />
          <DetailTableBody>
            {apiKeys.map(apiKey => (
              <ApiKeyDesktopRow
                key={apiKey.id}
                apiKey={apiKey}
                environment={environmentById.get(apiKey.environmentId)}
              />
            ))}
          </DetailTableBody>
        </DetailTable>
      </div>
    </>
  )
}
