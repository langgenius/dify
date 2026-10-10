'use client'
import type { ApiKeyItem } from '@dify/contracts/api/console/agent/types.gen'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { toast } from '@/app/notifications'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'

export function AgentApiKeyModal({
  agentId,
  open,
  onOpenChange,
}: {
  agentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(['appApi', 'appLog', 'common'])
  const { t: tCommon } = useTranslation(['common'])
  const { formatTime } = useTimestamp()
  const queryClient = useQueryClient()
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const deleteReturnFocusRef = useRef<HTMLButtonElement | null>(null)
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
  const createApiKeyMutation = useMutation(
    consoleQuery.agent.byAgentId.apiKeys.post.mutationOptions({
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
        toast.success(tCommon(($) => $['actionMsg.modifiedSuccessfully']))
      },
      onError: () => {
        toast.error(tCommon(($) => $['actionMsg.modifiedUnsuccessfully']))
      },
    }),
  )
  const deleteApiKeyMutation = useMutation(
    consoleQuery.agent.byAgentId.apiKeys.byApiKeyId.delete.mutationOptions({
      onSuccess: () => {
        deleteReturnFocusRef.current = createButtonRef.current
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
        toast.success(tCommon(($) => $['actionMsg.modifiedSuccessfully']))
      },
      onError: () => {
        toast.error(tCommon(($) => $['actionMsg.modifiedUnsuccessfully']))
      },
    }),
  )
  const apiKeys = apiKeysQuery.data?.data ?? []
  const isCreating = createApiKeyMutation.isPending
  const isDeleting = deleteApiKeyMutation.isPending
  const isPending = isCreating || isDeleting

  function handleCreateApiKey() {
    if (isPending) return

    createApiKeyMutation.mutate({
      params: {
        agent_id: agentId,
      },
    })
  }

  function handleDeleteApiKey() {
    if (!apiKeyToDelete || isPending) return

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
      <Dialog
        open={open}
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen && isPending) details.cancel()
          else handleOpenChange(nextOpen)
        }}
      >
        <DialogContent className="flex w-full max-w-200! flex-col px-8">
          <DialogClose
            disabled={isPending}
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                size="lg"
                className="absolute inset-e-6 top-6"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['apiKeyModal.apiSecretKey'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['apiKeyModal.apiSecretKeyTips'])}
          </DialogDescription>

          <div className="mt-4 min-h-20 overflow-x-auto overflow-y-hidden">
            <div className="max-h-70 min-w-184 overflow-x-hidden overflow-y-auto">
              <table className="w-full table-fixed">
                <caption className="sr-only">{t(($) => $['apiKeyModal.apiSecretKey'])}</caption>
                <colgroup>
                  <col className="w-64" />
                  <col className="w-50" />
                  <col className="w-50" />
                  <col />
                </colgroup>
                <thead className="sticky top-0 bg-components-panel-bg text-xs font-semibold text-text-tertiary">
                  <tr className="h-9 border-b border-divider-regular">
                    <th scope="col" className="px-3 text-left">
                      {t(($) => $['apiKeyModal.secretKey'])}
                    </th>
                    <th scope="col" className="px-3 text-left">
                      {t(($) => $['apiKeyModal.created'])}
                    </th>
                    <th scope="col" className="px-3 text-left">
                      {t(($) => $['apiKeyModal.lastUsed'])}
                    </th>
                    <th scope="col" className="px-3 text-left">
                      <span className="sr-only">
                        {tCommon(($) => $['operation.copy'])} /{' '}
                        {tCommon(($) => $['operation.delete'])}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-sm font-normal text-text-secondary">
                  {apiKeysQuery.isPending && (
                    <tr>
                      <td colSpan={4}>
                        <div
                          role="status"
                          className="flex h-20 items-center justify-center system-sm-regular text-text-tertiary"
                        >
                          {t(($) => $.loading)}
                        </div>
                      </td>
                    </tr>
                  )}
                  {apiKeysQuery.isError && (
                    <tr>
                      <td colSpan={4}>
                        <div className="flex h-20 items-center justify-center gap-2 system-sm-regular text-text-tertiary">
                          <span>{tCommon(($) => $['api.actionFailed'])}</span>
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={() => {
                              void apiKeysQuery.refetch()
                            }}
                          >
                            {tCommon(($) => $['operation.retry'])}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {apiKeysQuery.isSuccess && apiKeys.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="flex h-20 items-center justify-center system-sm-regular text-text-tertiary">
                          {tCommon(($) => $.noData)}
                        </div>
                      </td>
                    </tr>
                  )}
                  {apiKeysQuery.isSuccess &&
                    apiKeys.map((apiKey) => (
                      <tr
                        className="h-9 border-b border-divider-regular last:border-b-0"
                        key={apiKey.id}
                      >
                        <td className="truncate px-3 font-mono" translate="no">
                          {maskApiKey(apiKey.token)}
                        </td>
                        <td className="truncate px-3">
                          {apiKey.created_at
                            ? formatTime(
                                apiKey.created_at,
                                t(($) => $.dateTimeFormat, { ns: 'appLog' }),
                              )
                            : t(($) => $.never)}
                        </td>
                        <td className="truncate px-3">
                          {apiKey.last_used_at
                            ? formatTime(
                                apiKey.last_used_at,
                                t(($) => $.dateTimeFormat, { ns: 'appLog' }),
                              )
                            : t(($) => $.never)}
                        </td>
                        <td className="px-3">
                          <div className="flex gap-2">
                            <CopyFeedback content={apiKey.token} />
                            <IconButton
                              size="md"
                              aria-label={tCommon(($) => $['operation.delete'])}
                              disabled={isPending}
                              onClick={(event) => {
                                deleteReturnFocusRef.current = event.currentTarget
                                setApiKeyToDelete(apiKey)
                              }}
                            >
                              <span aria-hidden className="i-ri-delete-bin-line size-4" />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex justify-start">
            <Button
              ref={createButtonRef}
              onClick={handleCreateApiKey}
              loading={isCreating}
              disabled={isDeleting}
            >
              <span aria-hidden className="i-heroicons-plus-20-solid size-4" />
              {t(($) => $['apiKeyModal.createNewSecretKey'])}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AgentApiKeyGenerateModal apiKey={newKey} onClose={() => setNewKey(null)} />

      <AlertDialog
        open={Boolean(apiKeyToDelete)}
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen && isPending) details.cancel()
          else if (!nextOpen) setApiKeyToDelete(null)
        }}
      >
        <AlertDialogContent
          finalFocus={() =>
            deleteReturnFocusRef.current?.isConnected
              ? deleteReturnFocusRef.current
              : createButtonRef.current
          }
        >
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['actionMsg.deleteConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['actionMsg.deleteConfirmTips'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={isDeleting}
              disabled={isCreating}
              onClick={handleDeleteApiKey}
            >
              {tCommon(($) => $['operation.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
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
  return (
    <Dialog
      open={Boolean(apiKey)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent className="w-full max-w-120! overflow-hidden px-8">
        <AgentApiKeyGenerateContent token={apiKey?.token ?? ''} />
      </DialogContent>
    </Dialog>
  )
}

function AgentApiKeyGenerateContent({ token: initialToken }: { token: string }) {
  const { t } = useTranslation(['appApi', 'common'])
  const [token] = useState(() => initialToken)

  return (
    <>
      <DialogClose
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            size="lg"
            className="absolute inset-e-6 top-6"
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </IconButton>
        }
      />
      <DialogTitle className="title-2xl-semi-bold text-text-primary">
        {t(($) => $['apiKeyModal.apiSecretKey'])}
      </DialogTitle>
      <DialogDescription className="mt-1 text-[13px] leading-5 font-normal text-text-tertiary">
        {t(($) => $['apiKeyModal.generateTips'])}
      </DialogDescription>
      <div className="my-4 flex h-9 min-w-0 items-center rounded-lg bg-components-input-bg-normal px-2">
        <span
          className="min-w-0 flex-1 truncate font-mono system-sm-medium text-text-secondary"
          translate="no"
        >
          {token}
        </span>
        <CopyFeedback content={token} />
      </div>
      <div className="my-4 flex justify-end">
        <DialogClose render={<Button className="w-16 shrink-0" />}>
          {t(($) => $['actionMsg.ok'])}
        </DialogClose>
      </div>
    </>
  )
}

function maskApiKey(token: string) {
  if (token.length <= 24) return token

  return `${token.slice(0, 3)}...${token.slice(-20)}`
}
