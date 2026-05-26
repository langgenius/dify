'use client'

import type {
  ApiKey,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { FormEvent } from 'react'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
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

const API_TOKEN_NAME_ADJECTIVES = [
  'ancient',
  'autumn',
  'bright',
  'calm',
  'crystal',
  'gentle',
  'golden',
  'hidden',
  'holy',
  'quiet',
  'rapid',
  'silver',
]

const API_TOKEN_NAME_NOUNS = [
  'brook',
  'cloud',
  'field',
  'forest',
  'harbor',
  'lake',
  'meadow',
  'moon',
  'river',
  'stone',
  'valley',
  'wave',
]

function randomListItem(items: string[]) {
  return items[Math.floor(Math.random() * items.length)]!
}

function generateApiTokenName() {
  const suffix = Math.floor(1000 + Math.random() * 9000)

  return `${randomListItem(API_TOKEN_NAME_ADJECTIVES)}-${randomListItem(API_TOKEN_NAME_NOUNS)}-${suffix}`
}

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
  const queryClient = useQueryClient()
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false)
  const revokeApiKey = useMutation(consoleQuery.enterprise.accessService.deleteApiKey.mutationOptions())
  const isRevoking = revokeApiKey.isPending
  const apiKeyName = apiKey.name || apiKey.id || t('access.api.table.key')

  function invalidateApiKeys() {
    if (apiKey.appInstanceId && apiKey.environmentId) {
      return queryClient.invalidateQueries({
        queryKey: consoleQuery.enterprise.accessService.listApiKeys.key({
          type: 'query',
          input: {
            params: {
              appInstanceId: apiKey.appInstanceId,
              environmentId: apiKey.environmentId,
            },
          },
        }),
      })
    }

    return queryClient.invalidateQueries({
      queryKey: consoleQuery.enterprise.accessService.listApiKeys.key({ type: 'query' }),
    })
  }

  function handleRevoke() {
    if (!apiKey.id || isRevoking)
      return

    revokeApiKey.mutate(
      {
        params: {
          apiKeyId: apiKey.id,
        },
      },
      {
        onSuccess: async () => {
          await invalidateApiKeys()
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
        disabled={!apiKey.id || isRevoking}
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

export function ApiKeyGenerateMenu({ appInstanceId, environments, onCreatedToken }: {
  appInstanceId: string
  environments: Environment[]
  apiKeys: ApiKey[]
  onCreatedToken: (token: string) => void
}) {
  const { t } = useTranslation('deployments')
  const nameInputId = useId()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>()
  const [draftName, setDraftName] = useState('')
  const [nameError, setNameError] = useState(false)
  const generateApiKey = useMutation(consoleQuery.enterprise.accessService.createApiKey.mutationOptions())
  const selectableEnvironments = environments.filter(env => env.id)
  const selectedEnvironment = selectedEnvironmentId
    ? environments.find(env => env.id === selectedEnvironmentId)
    : undefined
  const disabled = selectableEnvironments.length === 0
  const isCreating = generateApiKey.isPending

  function resetCreateDialog() {
    setCreateDialogOpen(false)
    setSelectedEnvironmentId(undefined)
    setDraftName('')
    setNameError(false)
  }

  function handleOpenCreateDialog() {
    const firstEnvironmentId = selectableEnvironments[0]?.id
    if (!firstEnvironmentId)
      return

    setSelectedEnvironmentId(firstEnvironmentId)
    setDraftName(generateApiTokenName())
    setNameError(false)
    setCreateDialogOpen(true)
  }

  function handleEnvironmentChange(environmentId: string) {
    setSelectedEnvironmentId(environmentId)
    setNameError(false)
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen || isCreating)
      return

    resetCreateDialog()
  }

  function handleGenerateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = draftName.trim()

    if (!selectedEnvironmentId || !name) {
      setNameError(true)
      return
    }

    generateApiKey.mutate(
      {
        params: {
          appInstanceId,
          environmentId: selectedEnvironmentId,
        },
        body: {
          appInstanceId,
          environmentId: selectedEnvironmentId,
          name,
        },
      },
      {
        onSuccess: (response) => {
          if (response.token)
            onCreatedToken(response.token)
          resetCreateDialog()
        },
      },
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={handleOpenCreateDialog}
      >
        {t('access.api.newKey')}
      </Button>
      <Dialog open={createDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="w-120 max-w-[calc(100vw-32px)] overflow-hidden p-0">
          <DialogCloseButton disabled={isCreating} />
          <form onSubmit={handleGenerateApiKey}>
            <div className="border-b border-divider-subtle px-6 py-5 pr-14">
              <DialogTitle className="title-xl-semi-bold text-text-primary">
                {t('access.api.createKeyTitle')}
              </DialogTitle>
            </div>

            <div className="flex flex-col gap-4 px-6 py-5">
              <div>
                <label
                  htmlFor={nameInputId}
                  className="mb-1 block system-sm-medium text-text-secondary"
                >
                  {t('access.api.nameLabel')}
                </label>
                <Input
                  id={nameInputId}
                  value={draftName}
                  disabled={isCreating}
                  autoFocus
                  aria-invalid={nameError || undefined}
                  aria-describedby={nameError ? `${nameInputId}-error` : undefined}
                  placeholder={t('access.api.namePlaceholder')}
                  onChange={(event) => {
                    setDraftName(event.target.value)
                    if (nameError && event.target.value.trim())
                      setNameError(false)
                  }}
                />
                {nameError && (
                  <div id={`${nameInputId}-error`} className="mt-1 system-xs-regular text-text-destructive">
                    {t('access.api.nameRequired')}
                  </div>
                )}
              </div>

              <div>
                <Select
                  value={selectedEnvironmentId ?? null}
                  disabled={isCreating}
                  onValueChange={value => value && handleEnvironmentChange(value)}
                >
                  <SelectLabel className="mb-1 block system-sm-medium text-text-secondary">
                    {t('access.api.table.environment')}
                  </SelectLabel>
                  <SelectTrigger>
                    {environmentName(selectedEnvironment)}
                  </SelectTrigger>
                  <SelectContent>
                    {selectableEnvironments.map(env => (
                      <SelectItem key={env.id} value={env.id!}>
                        <SelectItemText>{environmentName(env)}</SelectItemText>
                        <SelectItemIndicator />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
              <Button
                type="button"
                variant="secondary"
                disabled={isCreating}
                onClick={() => handleDialogOpenChange(false)}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={isCreating}
                disabled={!selectedEnvironmentId || !draftName.trim()}
              >
                {t('access.api.createKey')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
