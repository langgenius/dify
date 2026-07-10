'use client'

import type { ApiKeyItem } from '@dify/contracts/api/console/agent/types.gen'
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
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CopyFeedback from '@/app/components/base/copy-feedback'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'

export function AgentApiKeyModal({
  agentId,
  open,
  onOpenChange,
}: {
  agentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('appApi')
  const { t: tCommon } = useTranslation('common')
  const { formatTime } = useTimestamp()
  const queryClient = useQueryClient()
  const [newKey, setNewKey] = useState<ApiKeyItem | null>(null)
  const [apiKeyToDelete, setApiKeyToDelete] = useState<ApiKeyItem | null>(null)
  const apiKeysQueryOptions = consoleQuery.agent.byAgentId.apiKeys.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  })
  const apiKeysQuery = useQuery({
    ...apiKeysQueryOptions,
    enabled: open,
  })
  const createApiKeyMutation = useMutation(consoleQuery.agent.byAgentId.apiKeys.post.mutationOptions({
    onSuccess: (createdKey) => {
      setNewKey(createdKey)
      queryClient.invalidateQueries({ queryKey: apiKeysQueryOptions.queryKey })
      queryClient.invalidateQueries({
        queryKey: consoleQuery.agent.byAgentId.apiAccess.get.queryKey({
          input: {
            params: {
              agent_id: agentId,
            },
          },
        }),
      })
      toast.success(tCommon($ => $['actionMsg.modifiedSuccessfully']))
    },
    onError: () => {
      toast.error(tCommon($ => $['actionMsg.modifiedUnsuccessfully']))
    },
  }))
  const deleteApiKeyMutation = useMutation(consoleQuery.agent.byAgentId.apiKeys.byApiKeyId.delete.mutationOptions({
    onSuccess: () => {
      setApiKeyToDelete(null)
      queryClient.invalidateQueries({ queryKey: apiKeysQueryOptions.queryKey })
      queryClient.invalidateQueries({
        queryKey: consoleQuery.agent.byAgentId.apiAccess.get.queryKey({
          input: {
            params: {
              agent_id: agentId,
            },
          },
        }),
      })
      toast.success(tCommon($ => $['actionMsg.modifiedSuccessfully']))
    },
    onError: () => {
      toast.error(tCommon($ => $['actionMsg.modifiedUnsuccessfully']))
    },
  }))
  const apiKeys = apiKeysQuery.data?.data ?? []
  const isCreating = createApiKeyMutation.isPending
  const isDeleting = deleteApiKeyMutation.isPending

  function handleCreateApiKey() {
    createApiKeyMutation.mutate({
      params: {
        agent_id: agentId,
      },
    })
  }

  function handleDeleteApiKey() {
    if (!apiKeyToDelete)
      return

    deleteApiKeyMutation.mutate({
      params: {
        agent_id: agentId,
        api_key_id: apiKeyToDelete.id,
      },
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setNewKey(null)
      setApiKeyToDelete(null)
    }

    onOpenChange(nextOpen)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex w-full max-w-[800px]! flex-col overflow-hidden px-8">
          <DialogCloseButton />
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t($ => $['apiKeyModal.apiSecretKey'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t($ => $['apiKeyModal.apiSecretKeyTips'])}
          </DialogDescription>

          <div className="mt-4 min-h-20 overflow-hidden">
            <div className="flex h-9 shrink-0 items-center border-b border-divider-regular text-xs font-semibold text-text-tertiary">
              <div className="w-64 shrink-0 px-3">{t($ => $['apiKeyModal.secretKey'])}</div>
              <div className="w-[200px] shrink-0 px-3">{t($ => $['apiKeyModal.created'])}</div>
              <div className="w-[200px] shrink-0 px-3">{t($ => $['apiKeyModal.lastUsed'])}</div>
              <div className="grow px-3" />
            </div>
            <div className="max-h-[280px] overflow-auto">
              {apiKeysQuery.isPending && (
                <div role="status" className="flex h-20 items-center justify-center system-sm-regular text-text-tertiary">
                  {t($ => $['loading'])}
                </div>
              )}
              {apiKeysQuery.isError && (
                <div className="flex h-20 items-center justify-center gap-2 system-sm-regular text-text-tertiary">
                  <span>{tCommon($ => $['api.actionFailed'])}</span>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                      void apiKeysQuery.refetch()
                    }}
                  >
                    {tCommon($ => $['operation.retry'])}
                  </Button>
                </div>
              )}
              {apiKeysQuery.isSuccess && apiKeys.length === 0 && (
                <div className="flex h-20 items-center justify-center system-sm-regular text-text-tertiary">
                  {tCommon($ => $['noData'])}
                </div>
              )}
              {apiKeysQuery.isSuccess && apiKeys.map(apiKey => (
                <div className="flex h-9 items-center border-b border-divider-regular text-sm font-normal text-text-secondary last:border-b-0" key={apiKey.id}>
                  <div className="w-64 shrink-0 truncate px-3 font-mono" translate="no">
                    {maskApiKey(apiKey.token)}
                  </div>
                  <div className="w-[200px] shrink-0 truncate px-3">
                    {apiKey.created_at ? formatTime(apiKey.created_at, t($ => $['dateTimeFormat'], { ns: 'appLog' })) : t($ => $['never'])}
                  </div>
                  <div className="w-[200px] shrink-0 truncate px-3">
                    {apiKey.last_used_at ? formatTime(apiKey.last_used_at, t($ => $['dateTimeFormat'], { ns: 'appLog' })) : t($ => $['never'])}
                  </div>
                  <div className="flex grow gap-2 px-3">
                    <CopyFeedback content={apiKey.token} />
                    <Button
                      variant="ghost"
                      size="small"
                      className="size-6 px-0 text-text-tertiary hover:text-text-secondary"
                      aria-label={tCommon($ => $['operation.delete'])}
                      disabled={isDeleting}
                      onClick={() => setApiKeyToDelete(apiKey)}
                    >
                      <span aria-hidden className="i-ri-delete-bin-line size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex justify-start">
            <Button onClick={handleCreateApiKey} loading={isCreating}>
              <span aria-hidden className="mr-1 i-heroicons-plus-20-solid size-4" />
              {t($ => $['apiKeyModal.createNewSecretKey'])}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AgentApiKeyGenerateModal
        apiKey={newKey}
        onClose={() => setNewKey(null)}
      />

      <AlertDialog
        open={Boolean(apiKeyToDelete)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen)
            setApiKeyToDelete(null)
        }}
      >
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t($ => $['actionMsg.deleteConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t($ => $['actionMsg.deleteConfirmTips'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {tCommon($ => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} onClick={handleDeleteApiKey}>
              {tCommon($ => $['operation.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AgentApiKeyGenerateModal({
  apiKey,
  onClose,
}: {
  apiKey: ApiKeyItem | null
  onClose: () => void
}) {
  const { t } = useTranslation('appApi')

  return (
    <Dialog
      open={Boolean(apiKey)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <DialogContent className="w-full max-w-[480px]! overflow-hidden px-8">
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t($ => $['apiKeyModal.apiSecretKey'])}
        </DialogTitle>
        <DialogDescription className="mt-1 text-[13px] leading-5 font-normal text-text-tertiary">
          {t($ => $['apiKeyModal.generateTips'])}
        </DialogDescription>
        <div className="my-4 flex h-9 min-w-0 items-center rounded-lg bg-components-input-bg-normal px-2">
          <span className="min-w-0 flex-1 truncate font-mono system-sm-medium text-text-secondary" translate="no">
            {apiKey?.token}
          </span>
          {apiKey && <CopyFeedback content={apiKey.token} />}
        </div>
        <div className="my-4 flex justify-end">
          <Button className="w-16 shrink-0" onClick={onClose}>
            {t($ => $['actionMsg.ok'])}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function maskApiKey(token: string) {
  if (token.length <= 24)
    return token

  return `${token.slice(0, 3)}...${token.slice(-20)}`
}
