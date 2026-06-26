'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { FormEvent, ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
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
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { generateApiTokenName } from './api-token-name'

type CreateApiKeyMutationInput = Parameters<
  NonNullable<ReturnType<typeof consoleQuery.enterprise.accessService.createApiKey.mutationOptions>['mutationFn']>
>[0]

function CreateApiKeyDialog({
  appInstanceId,
  environments,
  open,
  sessionKey,
  onCreatedToken,
  onOpenChange,
}: {
  appInstanceId?: string
  environments: Environment[]
  open: boolean
  sessionKey: number
  onCreatedToken: (token: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')
  const generateApiKey = useMutation(consoleQuery.enterprise.accessService.createApiKey.mutationOptions())
  const isCreating = generateApiKey.isPending

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen || isCreating)
      return

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] overflow-hidden p-0">
        <DialogCloseButton disabled={isCreating} />
        <CreateApiKeyForm
          key={sessionKey}
          appInstanceId={appInstanceId}
          environments={environments}
          isCreating={isCreating}
          onClose={() => handleOpenChange(false)}
          onCreate={(input) => {
            generateApiKey.mutate(input, {
              onSuccess: (response) => {
                if (response.token)
                  onCreatedToken(response.token)
                onOpenChange(false)
              },
              onError: () => {
                toast.error(t('access.api.createFailed'))
              },
            })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateApiKeyForm({
  appInstanceId,
  environments,
  isCreating,
  onClose,
  onCreate,
}: {
  appInstanceId?: string
  environments: Environment[]
  isCreating: boolean
  onClose: () => void
  onCreate: (input: CreateApiKeyMutationInput) => void
}) {
  const { t } = useTranslation('deployments')
  const nameInputId = useId()
  const firstEnvironment = environments[0]
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(firstEnvironment?.id)
  const [draftName, setDraftName] = useState(() => generateApiTokenName())
  const [nameError, setNameError] = useState(false)
  const selectedEnvironment = selectedEnvironmentId
    ? environments.find(env => env.id === selectedEnvironmentId)
    : undefined

  function handleEnvironmentChange(environmentId: string) {
    setSelectedEnvironmentId(environmentId)
    setNameError(false)
  }

  function handleDraftNameChange(nextDraftName: string) {
    setDraftName(nextDraftName)
    if (nameError && nextDraftName.trim())
      setNameError(false)
  }

  function handleGenerateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = draftName.trim()

    if (!appInstanceId || !selectedEnvironmentId || !name) {
      setNameError(true)
      return
    }

    onCreate({
      params: {
        appInstanceId,
        environmentId: selectedEnvironmentId,
      },
      body: {
        appInstanceId,
        environmentId: selectedEnvironmentId,
        displayName: name,
      },
    })
  }

  return (
    <form onSubmit={handleGenerateApiKey}>
      <div className="border-b border-divider-subtle px-6 py-5 pr-14">
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {t('access.api.createKeyTitle')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('access.api.description')}
        </DialogDescription>
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
            aria-invalid={nameError || undefined}
            aria-describedby={nameError ? `${nameInputId}-error` : undefined}
            placeholder={t('access.api.namePlaceholder')}
            onChange={(event) => {
              handleDraftNameChange(event.target.value)
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
              {selectedEnvironment?.displayName ?? '—'}
            </SelectTrigger>
            <SelectContent>
              {environments.map(env => (
                <SelectItem key={env.id} value={env.id}>
                  <SelectItemText>{env.displayName}</SelectItemText>
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
          onClick={onClose}
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={isCreating}
          disabled={isCreating || !selectedEnvironmentId}
        >
          {t('access.api.createKey')}
        </Button>
      </div>
    </form>
  )
}

export function ApiKeyGenerateMenu({
  environments,
  onCreatedToken,
  triggerVariant = 'secondary',
  triggerClassName,
  children,
}: {
  environments: Environment[]
  onCreatedToken: (token: string) => void
  triggerVariant?: ButtonProps['variant']
  triggerClassName?: string
  children?: (props: { trigger: ReactNode }) => ReactNode
}) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDialogSessionKey, setCreateDialogSessionKey] = useState(0)
  const disabled = !appInstanceId || environments.length === 0

  function handleOpenCreateDialog() {
    const firstEnvironment = environments[0]
    if (!firstEnvironment)
      return

    setCreateDialogSessionKey(sessionKey => sessionKey + 1)
    setCreateDialogOpen(true)
  }

  const trigger = (
    <Button
      type="button"
      variant={triggerVariant}
      disabled={disabled}
      onClick={handleOpenCreateDialog}
      className={cn('gap-1.5', triggerClassName)}
    >
      <span className="i-ri-add-line size-4" aria-hidden="true" />
      {t('access.api.newKey')}
    </Button>
  )

  return (
    <>
      {children ? children({ trigger }) : trigger}
      <CreateApiKeyDialog
        appInstanceId={appInstanceId}
        environments={environments}
        open={createDialogOpen}
        sessionKey={createDialogSessionKey}
        onCreatedToken={onCreatedToken}
        onOpenChange={setCreateDialogOpen}
      />
    </>
  )
}
