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
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { generateApiTokenName } from './api-token-name'

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
  const nameInputId = useId()
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>()
  const [draftName, setDraftName] = useState('')
  const [nameError, setNameError] = useState(false)
  const generateApiKey = useMutation(
    consoleQuery.enterprise.accessService.createApiKey.mutationOptions(),
  )
  const selectableEnvironments = environments
  const selectedEnvironment = selectedEnvironmentId
    ? selectableEnvironments.find((env) => env.id === selectedEnvironmentId)
    : undefined
  const disabled = !appInstanceId || selectableEnvironments.length === 0
  const isCreating = generateApiKey.isPending

  useEffect(() => {
    if (createDialogOpen) nameInputRef.current?.focus()
  }, [createDialogOpen])

  function handleOpenCreateDialog() {
    const firstEnvironment = selectableEnvironments[0]
    if (!firstEnvironment) return

    setSelectedEnvironmentId(firstEnvironment.id)
    setDraftName(generateApiTokenName())
    setNameError(false)
    setCreateDialogOpen(true)
  }

  function handleEnvironmentChange(environmentId: string) {
    setSelectedEnvironmentId(environmentId)
    setNameError(false)
  }

  function handleDraftNameChange(nextDraftName: string) {
    setDraftName(nextDraftName)
    if (nameError && nextDraftName.trim()) setNameError(false)
  }

  function resetCreateDialog() {
    setCreateDialogOpen(false)
    setSelectedEnvironmentId(undefined)
    setDraftName('')
    setNameError(false)
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen || isCreating) return

    resetCreateDialog()
  }

  function handleGenerateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = draftName.trim()

    if (!appInstanceId || !selectedEnvironmentId || !name) {
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
          displayName: name,
        },
      },
      {
        onSuccess: (response) => {
          if (response.token) onCreatedToken(response.token)
          resetCreateDialog()
        },
        onError: () => {
          toast.error(t(($) => $['access.api.createFailed']))
        },
      },
    )
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
      {t(($) => $['access.api.newKey'])}
    </Button>
  )

  return (
    <>
      {children ? children({ trigger }) : trigger}
      <Dialog open={createDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="w-120 max-w-[calc(100vw-32px)] overflow-hidden p-0">
          <DialogCloseButton disabled={isCreating} />
          <form onSubmit={handleGenerateApiKey}>
            <div className="border-b border-divider-subtle px-6 py-5 pr-14">
              <DialogTitle className="title-xl-semi-bold text-text-primary">
                {t(($) => $['access.api.createKeyTitle'])}
              </DialogTitle>
              <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
                {t(($) => $['access.api.description'])}
              </DialogDescription>
            </div>

            <div className="flex flex-col gap-4 px-6 py-5">
              <div>
                <label
                  htmlFor={nameInputId}
                  className="mb-1 block system-sm-medium text-text-secondary"
                >
                  {t(($) => $['access.api.nameLabel'])}
                </label>
                <Input
                  ref={nameInputRef}
                  id={nameInputId}
                  value={draftName}
                  disabled={isCreating}
                  aria-invalid={nameError || undefined}
                  aria-describedby={nameError ? `${nameInputId}-error` : undefined}
                  placeholder={t(($) => $['access.api.namePlaceholder'])}
                  onChange={(event) => {
                    handleDraftNameChange(event.target.value)
                  }}
                />
                {nameError && (
                  <div
                    id={`${nameInputId}-error`}
                    className="mt-1 system-xs-regular text-text-destructive"
                  >
                    {t(($) => $['access.api.nameRequired'])}
                  </div>
                )}
              </div>

              <div>
                <Select
                  value={selectedEnvironmentId ?? null}
                  disabled={isCreating}
                  onValueChange={(value) => value && handleEnvironmentChange(value)}
                >
                  <SelectLabel className="mb-1 block system-sm-medium text-text-secondary">
                    {t(($) => $['access.api.table.environment'])}
                  </SelectLabel>
                  <SelectTrigger>{selectedEnvironment?.displayName ?? '—'}</SelectTrigger>
                  <SelectContent>
                    {selectableEnvironments.map((env) => (
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
                onClick={() => handleDialogOpenChange(false)}
              >
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={isCreating}
                disabled={isCreating || !selectedEnvironmentId}
              >
                {t(($) => $['access.api.createKey'])}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
