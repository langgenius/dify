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
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex min-w-35 flex-col">
        <span className="system-sm-medium text-text-primary">{apiKey.name || apiKey.id}</span>
        <span className="system-xs-regular text-text-tertiary">
          {t('access.api.envPrefix', { env: environmentLabel })}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-components-input-border-active bg-components-input-bg-normal pr-1 pl-2">
        <div className="min-w-0 flex-1 truncate font-mono system-sm-medium text-text-secondary">
          {displayValue}
        </div>
        <button
          type="button"
          onClick={handleRevoke}
          aria-label={t('access.revoke')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
        >
          <span className="i-ri-delete-bin-line size-3.5" />
        </button>
      </div>
    </div>
  )
}

export function ApiKeyList({ appInstanceId, apiKeys }: {
  appInstanceId: string
  apiKeys: DeveloperApiKeyRow[]
}) {
  return (
    <div className="flex flex-col divide-y divide-divider-subtle">
      {apiKeys.map(apiKey => (
        <ApiKeyRow
          key={apiKey.id}
          appInstanceId={appInstanceId}
          apiKey={apiKey}
        />
      ))}
    </div>
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
