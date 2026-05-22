'use client'

import type {
  ApiKey,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { environmentName } from '../../../environment'
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
      {apiKey.name || apiKey.id || '—'}
    </span>
  )
}

function EnvironmentBadge({ environment }: {
  environment?: Environment
}) {
  return (
    <span className="inline-flex h-5 max-w-36 items-center rounded-md bg-background-section-burn px-1.5 text-xs text-text-tertiary">
      <span className="truncate">{environmentName(environment)}</span>
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
  const revokeApiKey = useMutation(consoleQuery.enterprise.accessService.deleteApiKey.mutationOptions())

  function handleRevoke() {
    if (!apiKey.id)
      return

    revokeApiKey.mutate({
      params: {
        apiKeyId: apiKey.id,
      },
    })
  }

  return (
    <button
      type="button"
      onClick={handleRevoke}
      aria-label={t('access.revoke')}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid"
    >
      <span className="i-ri-delete-bin-line size-3.5" />
    </button>
  )
}

function ApiKeyMobileRow({ apiKey, environment }: {
  apiKey: ApiKey
  environment?: Environment
}) {
  const { t } = useTranslation('deployments')
  const displayValue = apiKey.maskedToken || apiKey.id || '—'

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
  const displayValue = apiKey.maskedToken || apiKey.id || '—'

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

function ApiKeyTable({ apiKeys, environments }: {
  apiKeys: ApiKey[]
  environments: Environment[]
}) {
  const environmentById = new Map(environments.map(environment => [environment.id, environment]))

  return (
    <>
      <DetailTableCardList className={cn('pc:hidden')}>
        {apiKeys.map((apiKey, index) => (
          <ApiKeyMobileRow
            key={apiKey.id ?? apiKey.maskedToken ?? apiKey.name ?? index}
            apiKey={apiKey}
            environment={apiKey.environmentId ? environmentById.get(apiKey.environmentId) : undefined}
          />
        ))}
      </DetailTableCardList>
      <div className="hidden pc:block">
        <DetailTable>
          <ApiKeyTableHeader />
          <DetailTableBody>
            {apiKeys.map((apiKey, index) => (
              <ApiKeyDesktopRow
                key={apiKey.id ?? apiKey.maskedToken ?? apiKey.name ?? index}
                apiKey={apiKey}
                environment={apiKey.environmentId ? environmentById.get(apiKey.environmentId) : undefined}
              />
            ))}
          </DetailTableBody>
        </DetailTable>
      </div>
    </>
  )
}

export function ApiKeyList({ apiKeys, environments }: {
  apiKeys: ApiKey[]
  environments: Environment[]
}) {
  return (
    <ApiKeyTable apiKeys={apiKeys} environments={environments} />
  )
}

export function ApiKeyGenerateMenu({ appInstanceId, environments, apiKeys, onCreatedToken }: {
  appInstanceId: string
  environments: Environment[]
  apiKeys: ApiKey[]
  onCreatedToken: (token: string) => void
}) {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)
  const generateApiKey = useMutation(consoleQuery.enterprise.accessService.createApiKey.mutationOptions())
  const selectableEnvironments = environments.filter(env => env.id)
  const disabled = selectableEnvironments.length === 0

  function createApiKeyLabel(environmentId: string) {
    const existingCount = apiKeys.filter(key =>
      key.environmentId === environmentId,
    ).length
    const name = environments.find(env => env.id === environmentId)?.name ?? 'env'

    return `${name}-key-${String(existingCount + 1).padStart(3, '0')}`
  }

  function handleGenerateApiKey(environmentId: string) {
    generateApiKey.mutate(
      {
        params: {
          appInstanceId,
          environmentId,
        },
        body: {
          appInstanceId,
          environmentId,
          name: createApiKeyLabel(environmentId),
        },
      },
      {
        onSuccess: (response) => {
          if (response.token)
            onCreatedToken(response.token)
        },
      },
    )
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 system-sm-medium',
          'border border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text',
          'hover:bg-components-button-secondary-bg-hover',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="i-ri-add-line size-3.5" />
        {t('access.api.newKey')}
        <span className="i-ri-arrow-down-s-line size-3.5" />
      </DropdownMenuTrigger>
      {open && !disabled && (
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-55">
          {selectableEnvironments.map(env => (
            <DropdownMenuItem
              key={env.id}
              className="gap-2 px-3"
              onClick={() => {
                setOpen(false)
                handleGenerateApiKey(env.id!)
              }}
            >
              <span className="system-sm-regular text-text-secondary">
                {t('access.api.newKeyForEnv', { env: environmentName(env) })}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
