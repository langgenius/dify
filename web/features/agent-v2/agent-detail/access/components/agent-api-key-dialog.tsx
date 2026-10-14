'use client'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { DialogProps } from '@langgenius/dify-ui/dialog'
import type { ApiKeyDeleteTarget } from '@/app/components/api-key/api-key-table'
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
import { Dialog } from '@langgenius/dify-ui/dialog'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  API_KEY_LIMIT,
  ApiKeyCreateAction,
  ApiKeyDialogContent,
} from '@/app/components/api-key/api-key-dialog-content'
import { ApiKeyTable } from '@/app/components/api-key/api-key-table'
import { CreatedApiKeyDialog } from '@/app/components/api-key/created-api-key-dialog'
import { maskApiKey } from '@/app/components/api-key/mask-api-key'
import { consoleQuery } from '@/service/console'

type AgentApiKeyDialogProps = Required<Pick<DialogProps, 'open' | 'onOpenChange'>> & {
  agentId: string
}

export function AgentApiKeyDialog({ agentId, open, onOpenChange }: AgentApiKeyDialogProps) {
  const createApiKeyMutation = useMutation(
    consoleQuery.agent.byAgentId.apiKeys.post.mutationOptions(),
  )
  const deleteApiKeyMutation = useMutation(
    consoleQuery.agent.byAgentId.apiKeys.byApiKeyId.delete.mutationOptions(),
  )
  const isPending = createApiKeyMutation.isPending || deleteApiKeyMutation.isPending

  const createKey: AgentApiKeyDialogBodyProps['onCreate'] = (onSuccess) => {
    if (createApiKeyMutation.isPending) return
    createApiKeyMutation.mutate({ params: { agent_id: agentId } }, { onSuccess })
  }
  const deleteKey: AgentApiKeyDialogBodyProps['onDelete'] = (keyId, onSuccess) => {
    if (deleteApiKeyMutation.isPending) return
    deleteApiKeyMutation.mutate({ params: { agent_id: agentId, api_key_id: keyId } }, { onSuccess })
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending) details.cancel()
        else onOpenChange(nextOpen, details)
      }}
    >
      <ApiKeyDialogContent closeDisabled={isPending} limit={API_KEY_LIMIT}>
        <AgentApiKeyDialogBody
          agentId={agentId}
          isCreating={createApiKeyMutation.isPending}
          isDeleting={deleteApiKeyMutation.isPending}
          createdKey={createApiKeyMutation.data?.token}
          onCreate={createKey}
          onDelete={deleteKey}
        />
      </ApiKeyDialogContent>
    </Dialog>
  )
}

type AgentApiKeyDialogBodyProps = Pick<AgentApiKeyDialogProps, 'agentId'> & {
  isCreating: boolean
  isDeleting: boolean
  createdKey: string | undefined
  onCreate: (onSuccess: () => void) => void
  onDelete: (keyId: string, onSuccess: () => void) => void
}

function AgentApiKeyDialogBody({
  agentId,
  isCreating,
  isDeleting,
  createdKey,
  onCreate,
  onDelete,
}: AgentApiKeyDialogBodyProps) {
  const { t } = useTranslation(['appApi', 'common'])
  const [createdDialogOpen, setCreatedDialogOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const deleteActionsRef = useRef<AlertDialogActions>(null)
  const deleteSucceededRef = useRef(false)
  const apiKeysQuery = useSuspenseQuery(
    consoleQuery.agent.byAgentId.apiKeys.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )

  const apiKeys = apiKeysQuery.data.data
  const createDisabled =
    !apiKeysQuery.isSuccess || apiKeysQuery.isFetching || apiKeys.length >= API_KEY_LIMIT

  const handleCreateApiKey = () => {
    if (createDisabled || isCreating) return
    onCreate(() => setCreatedDialogOpen(true))
  }
  const handleDeleteApiKey = (key: ApiKeyDeleteTarget | undefined) => {
    if (!key || isDeleting) return
    onDelete(key.id, () => {
      deleteSucceededRef.current = true
      deleteActionsRef.current?.close()
    })
  }
  return (
    <>
      <span role="status" className="sr-only">
        {isCreating || isDeleting || apiKeysQuery.isFetching
          ? t(($) => $.loading, { ns: 'common' })
          : ''}
      </span>
      {apiKeysQuery.isError && (
        <div className="flex items-center gap-2 px-6 py-4">
          <p role="status">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              void apiKeysQuery.refetch()
            }}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      <AlertDialog<ApiKeyDeleteTarget>
        actionsRef={deleteActionsRef}
        onOpenChange={(nextOpen, details) => {
          if (nextOpen) deleteSucceededRef.current = false
          if (!nextOpen && isDeleting && details.reason !== 'imperative-action') details.cancel()
        }}
      >
        {({ payload }) => (
          <>
            <ApiKeyTable apiKeys={apiKeys} canManage allowCopy />
            <AlertDialogContent
              backdropProps={{ forceRender: true }}
              finalFocus={() => (deleteSucceededRef.current ? createButtonRef.current : true)}
            >
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['actionMsg.deleteConfirmTitle'])}
                </AlertDialogTitle>
                <AlertDialogDescription className="system-md-regular wrap-break-word text-text-tertiary">
                  <span className="mb-2 block font-mono" translate="no">
                    {payload && maskApiKey(payload.token)}
                  </span>
                  {t(($) => $['actionMsg.deleteConfirmTips'])}
                </AlertDialogDescription>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancelButton disabled={isDeleting}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  loading={isDeleting}
                  onClick={() => handleDeleteApiKey(payload)}
                >
                  {t(($) => $['operation.delete'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogFooter>
            </AlertDialogContent>
          </>
        )}
      </AlertDialog>
      <ApiKeyCreateAction
        ref={createButtonRef}
        count={apiKeys.length}
        limit={API_KEY_LIMIT}
        disabled={createDisabled}
        focusableWhenDisabled
        loading={isCreating}
        onClick={handleCreateApiKey}
      />
      <CreatedApiKeyDialog
        open={createdDialogOpen}
        onOpenChange={setCreatedDialogOpen}
        value={createdKey}
        finalFocus={createButtonRef}
      />
    </>
  )
}
