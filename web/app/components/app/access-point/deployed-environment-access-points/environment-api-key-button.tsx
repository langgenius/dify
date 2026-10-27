'use client'
import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiKeyCreateAction,
  ApiKeyDialogContent,
} from '@/app/components/api-key/api-key-dialog-content'
import { ApiKeyListContent } from '@/app/components/api-key/api-key-list-content'
import { CreatedApiKeyDialog } from '@/app/components/api-key/created-api-key-dialog'
import { consoleQuery } from '@/service/console'

type EnvironmentApiKeyButtonProps = {
  appId: string
  environmentId: string
  apiKeyCount?: number
  canManage: boolean
  disabled?: boolean
}

export function EnvironmentApiKeyButton({
  appId,
  environmentId,
  apiKeyCount = 0,
  canManage,
  disabled = false,
}: EnvironmentApiKeyButtonProps) {
  const { t } = useTranslation(['appApi'])
  const createKey = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.createEnvironmentApiKey.mutationOptions(),
  )
  const deleteKey = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.deleteEnvironmentApiKey.mutationOptions(),
  )
  const pending = createKey.isPending || deleteKey.isPending
  const buttonDisabled = disabled || !canManage
  return (
    <Dialog
      onOpenChange={(open, details) => {
        if (!open && pending) details.cancel()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="secondary" size="medium" className="px-3" disabled={buttonDisabled} />
        }
      >
        <span aria-hidden className="i-ri-key-2-line size-4" />
        {t(($) => $['apiKeyModal.apiSecretKey'])}
        <span
          className={cn(
            'flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase tabular-nums',
            buttonDisabled ? 'text-text-disabled' : 'text-text-tertiary',
          )}
        >
          {apiKeyCount}
        </span>
      </DialogTrigger>
      <ApiKeyDialogContent closeDisabled={pending}>
        <EnvironmentApiKeys
          appId={appId}
          environmentId={environmentId}
          canManage={canManage}
          isCreating={createKey.isPending}
          isDeleting={deleteKey.isPending}
          createdKey={createKey.data?.token}
          onCreate={(onSuccess) => {
            if (!canManage || pending) return
            createKey.mutate(
              { params: { app_id: appId, environment_id: environmentId } },
              { onSuccess },
            )
          }}
          onDelete={(keyId, onSuccess) => {
            if (!canManage || pending) return
            deleteKey.mutate(
              {
                params: { app_id: appId, environment_id: environmentId, api_key_id: keyId },
              },
              { onSuccess },
            )
          }}
        />
      </ApiKeyDialogContent>
    </Dialog>
  )
}

type EnvironmentApiKeysProps = Pick<
  EnvironmentApiKeyButtonProps,
  'appId' | 'canManage' | 'environmentId'
> &
  Pick<ComponentProps<typeof ApiKeyListContent>, 'isDeleting' | 'onDelete'> & {
    isCreating: boolean
    createdKey: string | undefined
    onCreate: (onSuccess: () => void) => void
  }

function EnvironmentApiKeys({
  appId,
  environmentId,
  canManage,
  isCreating,
  isDeleting,
  createdKey,
  onCreate,
  onDelete,
}: EnvironmentApiKeysProps) {
  const keys = useSuspenseQuery(
    consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryOptions({
      input: { params: { app_id: appId, environment_id: environmentId } },
    }),
  )
  const [createdOpen, setCreatedOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  return (
    <ApiKeyListContent
      apiKeys={keys.data.data}
      canManage={canManage}
      isDeleting={isDeleting}
      isFetching={keys.isFetching}
      isError={keys.isError}
      onRetry={() => {
        void keys.refetch()
      }}
      onDelete={onDelete}
      finalFocus={createButtonRef}
    >
      <ApiKeyCreateAction
        ref={createButtonRef}
        disabled={!canManage}
        focusableWhenDisabled={canManage}
        loading={isCreating}
        onClick={() => onCreate(() => setCreatedOpen(true))}
      />
      <CreatedApiKeyDialog
        open={createdOpen}
        onOpenChange={setCreatedOpen}
        value={createdKey}
        finalFocus={createButtonRef}
      />
    </ApiKeyListContent>
  )
}
