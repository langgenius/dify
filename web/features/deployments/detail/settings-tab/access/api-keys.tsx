'use client'

import type { AppDeployEnvironment, DeveloperApiKeyRow } from '@dify/contracts/enterprise/types.gen'
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

function ApiKeyRow({ appInstanceId, apiKey }: {
  appInstanceId: string
  apiKey: DeveloperApiKeyRow
}) {
  const { t } = useTranslation('deployments')
  const revokeApiKey = useMutation(consoleQuery.enterprise.appDeployAccessService.deleteDeveloperApiKey.mutationOptions())
  const displayValue = apiKey.maskedKey || apiKey.id || '—'
  const environmentLabel = environmentName(apiKey.environment)

  function handleRevoke() {
    const environmentId = apiKey.environment?.id
    if (!apiKey.id || !environmentId)
      return

    revokeApiKey.mutate({
      params: {
        appInstanceId,
        environmentId,
        apiKeyId: apiKey.id,
      },
    })
  }

  return (
    <tr className="border-t border-divider-subtle">
      <td className="px-3 py-2.5 align-middle">
        <div className="max-w-54 truncate system-sm-medium text-text-primary">
          {apiKey.name || apiKey.id}
        </div>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <span className="inline-flex h-5 max-w-36 items-center rounded-md bg-background-section-burn px-1.5 system-xs-medium text-text-tertiary">
          <span className="truncate">{environmentLabel}</span>
        </span>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div className="flex h-8 min-w-0 items-center rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2">
          <div className="min-w-0 flex-1 truncate font-mono system-sm-medium text-text-secondary">
            {displayValue}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right align-middle">
        <button
          type="button"
          onClick={handleRevoke}
          aria-label={t('access.revoke')}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
        >
          <span className="i-ri-delete-bin-line size-3.5" />
        </button>
      </td>
    </tr>
  )
}

function ApiKeyTableHeader() {
  const { t } = useTranslation('deployments')

  return (
    <thead>
      <tr className="bg-background-default-subtle text-left system-xs-medium-uppercase text-text-tertiary">
        <th className="w-56 px-3 py-2 font-medium">
          {t('access.api.table.name')}
        </th>
        <th className="w-40 px-3 py-2 font-medium">
          {t('access.api.table.environment')}
        </th>
        <th className="px-3 py-2 font-medium">
          {t('access.api.table.key')}
        </th>
        <th className="w-18 px-3 py-2 text-right font-medium">
          {t('access.api.table.action')}
        </th>
      </tr>
    </thead>
  )
}

function ApiKeyTable({ appInstanceId, apiKeys }: {
  appInstanceId: string
  apiKeys: DeveloperApiKeyRow[]
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-divider-subtle">
      <table className="w-full min-w-175 table-fixed border-collapse">
        <ApiKeyTableHeader />
        <tbody className="bg-components-panel-bg">
          {apiKeys.map(apiKey => (
            <ApiKeyRow
              key={apiKey.id}
              appInstanceId={appInstanceId}
              apiKey={apiKey}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ApiKeyList({ appInstanceId, apiKeys }: {
  appInstanceId: string
  apiKeys: DeveloperApiKeyRow[]
}) {
  return (
    <ApiKeyTable appInstanceId={appInstanceId} apiKeys={apiKeys} />
  )
}

export function ApiKeyGenerateMenu({ appInstanceId, environments, apiKeys, onCreatedToken }: {
  appInstanceId: string
  environments: AppDeployEnvironment[]
  apiKeys: DeveloperApiKeyRow[]
  onCreatedToken: (token: string) => void
}) {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)
  const generateApiKey = useMutation(consoleQuery.enterprise.appDeployAccessService.createDeveloperApiKey.mutationOptions())
  const selectableEnvironments = environments.filter(env => env.id)
  const disabled = selectableEnvironments.length === 0

  function createApiKeyLabel(environmentId: string) {
    const existingCount = apiKeys.filter(key =>
      key.environment?.id === environmentId,
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
