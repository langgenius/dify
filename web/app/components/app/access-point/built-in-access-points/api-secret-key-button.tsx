'use client'
import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { skipToken, useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  API_KEY_LIMIT,
  ApiKeyCreateAction,
  ApiKeyDialogContent,
} from '@/app/components/api-key/api-key-dialog-content'
import { ApiKeyListContent } from '@/app/components/api-key/api-key-list-content'
import { CreatedApiKeyDialog } from '@/app/components/api-key/created-api-key-dialog'
import { consoleQuery } from '@/service/console'

type ApiSecretKeyButtonProps = {
  appId: string
  canManage: boolean
  disabled?: boolean
}

export function ApiSecretKeyButton({
  appId,
  canManage,
  disabled = false,
}: ApiSecretKeyButtonProps) {
  const { t } = useTranslation(['appApi'])
  const createKey = useMutation(consoleQuery.apps.byResourceId.apiKeys.post.mutationOptions())
  const deleteKey = useMutation(
    consoleQuery.apps.byResourceId.apiKeys.byApiKeyId.delete.mutationOptions(),
  )
  const pending = createKey.isPending || deleteKey.isPending
  const keys = useQuery(
    consoleQuery.apps.byResourceId.apiKeys.get.queryOptions({
      input: canManage ? { params: { resource_id: appId } } : skipToken,
    }),
  )
  const apiKeyCount = keys.data?.data.length ?? 0
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
      <ApiKeyDialogContent
        closeDisabled={pending}
        limitDescription={t(($) => $['apiKeyModal.keyLimit'], { limit: API_KEY_LIMIT })}
      >
        <AppApiKeys
          appId={appId}
          canManage={canManage}
          isCreating={createKey.isPending}
          isDeleting={deleteKey.isPending}
          createdKey={createKey.data?.token}
          onCreate={(onSuccess) => {
            if (!canManage || pending) return
            createKey.mutate({ params: { resource_id: appId } }, { onSuccess })
          }}
          onDelete={(keyId, onSuccess) => {
            if (!canManage || pending) return
            deleteKey.mutate({ params: { resource_id: appId, api_key_id: keyId } }, { onSuccess })
          }}
        />
      </ApiKeyDialogContent>
    </Dialog>
  )
}

type AppApiKeysProps = Pick<ApiSecretKeyButtonProps, 'appId' | 'canManage'> &
  Pick<ComponentProps<typeof ApiKeyListContent>, 'isDeleting' | 'onDelete'> & {
    isCreating: boolean
    createdKey: string | undefined
    onCreate: (onSuccess: () => void) => void
  }

function AppApiKeys({
  appId,
  canManage,
  isCreating,
  isDeleting,
  createdKey,
  onCreate,
  onDelete,
}: AppApiKeysProps) {
  const keys = useSuspenseQuery(
    consoleQuery.apps.byResourceId.apiKeys.get.queryOptions({
      input: { params: { resource_id: appId } },
    }),
  )
  const [createdOpen, setCreatedOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const atLimit = keys.data.data.length >= API_KEY_LIMIT
  return (
    <ApiKeyListContent
      apiKeys={keys.data.data}
      canManage={canManage}
      allowCopy
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
        atLimit={atLimit}
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
