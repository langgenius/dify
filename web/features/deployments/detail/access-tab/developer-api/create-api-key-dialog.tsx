'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { generateApiTokenName } from './api-token-name'

type CreateApiKeyFormValues = {
  displayName: string
  environmentId: string
}

export function CreateApiKeyDialog({
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
  const closeBlockedRef = useRef(false)
  const [closeBlocked, setCloseBlocked] = useState(false)

  function handleCloseBlockedChange(blocked: boolean) {
    closeBlockedRef.current = blocked
    setCloseBlocked(blocked)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && closeBlockedRef.current)
      return

    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} disablePointerDismissal={closeBlocked} onOpenChange={handleOpenChange}>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] overflow-hidden p-0">
        <CreateApiKeyDialogContent
          key={sessionKey}
          appInstanceId={appInstanceId}
          environments={environments}
          onClose={() => onOpenChange(false)}
          onCloseBlockedChange={handleCloseBlockedChange}
          onCreatedToken={onCreatedToken}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateApiKeyDialogContent({
  appInstanceId,
  environments,
  onClose,
  onCloseBlockedChange,
  onCreatedToken,
}: {
  appInstanceId?: string
  environments: Environment[]
  onClose: () => void
  onCloseBlockedChange: (blocked: boolean) => void
  onCreatedToken: (token: string) => void
}) {
  const { t } = useTranslation('deployments')
  const generateApiKey = useMutation(consoleQuery.enterprise.accessService.createApiKey.mutationOptions())
  const isCreating = generateApiKey.isPending
  const firstEnvironment = environments[0]
  const nameRequiredMessage = t('access.api.nameRequired')

  function handleClose() {
    if (isCreating)
      return
    onClose()
  }

  function handleGenerateApiKey(values: CreateApiKeyFormValues) {
    const displayName = values.displayName.trim()
    const environmentId = values.environmentId

    if (!appInstanceId || !environmentId || !displayName)
      return

    onCloseBlockedChange(true)
    generateApiKey.mutate(
      {
        params: {
          appInstanceId,
          environmentId,
        },
        body: {
          appInstanceId,
          environmentId,
          displayName,
        },
      },
      {
        onSuccess: (response) => {
          if (response.token)
            onCreatedToken(response.token)
          onClose()
        },
        onError: () => {
          toast.error(t('access.api.createFailed'))
        },
        onSettled: () => {
          onCloseBlockedChange(false)
        },
      },
    )
  }

  return (
    <>
      <DialogCloseButton disabled={isCreating} />
      <div className="border-b border-divider-subtle px-6 py-5 pr-14">
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {t('access.api.createKeyTitle')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('access.api.description')}
        </DialogDescription>
      </div>

      <Form<CreateApiKeyFormValues> onFormSubmit={handleGenerateApiKey}>
        <div className="flex flex-col gap-4 px-6 py-5">
          <FieldRoot
            name="displayName"
            validate={(value) => {
              if (typeof value === 'string' && value.length > 0 && !value.trim())
                return nameRequiredMessage

              return null
            }}
          >
            <FieldLabel className="system-sm-medium text-text-secondary">
              {t('access.api.nameLabel')}
            </FieldLabel>
            <FieldControl
              defaultValue={generateApiTokenName()}
              disabled={isCreating}
              autoComplete="off"
              placeholder={t('access.api.namePlaceholder')}
              required
            />
            <FieldError match="valueMissing" className="system-xs-regular">{nameRequiredMessage}</FieldError>
            <FieldError match="customError" className="system-xs-regular" />
          </FieldRoot>

          <FieldRoot name="environmentId">
            <Select
              name="environmentId"
              defaultValue={firstEnvironment?.id}
              disabled={isCreating}
            >
              <SelectLabel className="system-sm-medium text-text-secondary">
                {t('access.api.table.environment')}
              </SelectLabel>
              <SelectTrigger>
                <SelectValue />
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
          </FieldRoot>
        </div>

        <div className="flex justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
          <Button
            type="button"
            variant="secondary"
            disabled={isCreating}
            onClick={handleClose}
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={isCreating}
            disabled={isCreating || !firstEnvironment}
          >
            {t('access.api.createKey')}
          </Button>
        </div>
      </Form>
    </>
  )
}
